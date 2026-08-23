use git2::{SubmoduleIgnore, SubmoduleStatus};
use std::path::{Path, PathBuf};

use crate::git::{
    credentials::make_credentials_callback,
    encoding::decode_ref_name,
    error::{GitError, GitResult},
    shellout::{is_ssh_url, run_git},
    types::*,
};

use super::GitEngine;

impl GitEngine {
    pub fn list_submodules(path: &str) -> GitResult<Vec<SubmoduleInfo>> {
        let repo = Self::open(path)?;
        let mut result = Vec::new();

        for sub in repo.submodules()? {
            let name = decode_ref_name(sub.name_bytes());
            if name.is_empty() {
                continue;
            }
            let sub_path = sub.path().to_string_lossy().to_string();
            let url = sub.url().map(|s| s.to_string());
            let head_oid = sub.head_id().map(|o| o.to_string());
            let workdir_oid = sub.workdir_id().map(|o| o.to_string());

            let status = repo
                .submodule_status(&name, SubmoduleIgnore::Unspecified)
                .unwrap_or(SubmoduleStatus::empty());

            let state = Self::classify_submodule_state(&status);
            let has_workdir_modifications = status.is_wd_wd_modified()
                || status.contains(SubmoduleStatus::WD_INDEX_MODIFIED)
                || status.is_wd_untracked();

            result.push(SubmoduleInfo {
                name,
                path: sub_path,
                url,
                head_oid,
                workdir_oid,
                state,
                has_workdir_modifications,
            });
        }

        Ok(result)
    }

    fn classify_submodule_state(status: &SubmoduleStatus) -> SubmoduleState {
        // 条目存在于 config/index/head 中，但磁盘上完全找不到 → NotFound
        if !status.is_in_wd()
            && !status.is_in_config()
            && !status.is_in_index()
            && !status.is_in_head()
        {
            return SubmoduleState::NotFound;
        }

        // .gitmodules 中存在但 .git/config 中未注册 → 未 init
        if !status.is_in_config() {
            return SubmoduleState::Uninitialized;
        }

        // 已 init 但工作区未 clone
        if status.is_wd_uninitialized() {
            return SubmoduleState::NotCloned;
        }

        // 工作区有修改（脏工作区 / index 差异 / commit 偏离父记录）
        let is_dirty = status.is_wd_modified()
            || status.is_wd_wd_modified()
            || status.contains(SubmoduleStatus::WD_INDEX_MODIFIED)
            || status.is_wd_untracked()
            || status.is_index_modified()
            || status.is_index_added()
            || status.is_index_deleted();

        if is_dirty {
            SubmoduleState::Modified
        } else {
            SubmoduleState::UpToDate
        }
    }

    /// 仅注册 submodule 到 .git/config（不 clone）
    pub fn init_submodule(path: &str, name: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let mut sub = repo.find_submodule(name)?;
        sub.init(false)?;
        Ok(())
    }

    /// Clone 缺失的 submodule 并 checkout 到父仓库记录的 commit
    pub fn update_submodule(path: &str, name: &str) -> GitResult<()> {
        // submodule URL 是 SSH 时 fallback 到系统 git，避开 libssh2 的限制
        let url_is_ssh = {
            let repo = Self::open(path)?;
            let sub = repo.find_submodule(name)?;
            sub.url().map(is_ssh_url).unwrap_or(false)
        };
        if url_is_ssh {
            run_git(path, &["submodule", "update", "--init", "--", name])?;
            return Ok(());
        }

        let repo = Self::open(path)?;
        let mut sub = repo.find_submodule(name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());
        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);

        let mut update_opts = git2::SubmoduleUpdateOptions::new();
        update_opts.fetch(fetch_opts);

        sub.update(true, Some(&mut update_opts))?;
        Ok(())
    }

    /// 修改 submodule 的 URL（写入 .gitmodules，并同步到 .git/config）
    pub fn set_submodule_url(path: &str, name: &str, new_url: &str) -> GitResult<()> {
        let mut repo = Self::open(path)?;
        repo.submodule_set_url(name, new_url)?;
        // sync 会把 .gitmodules 中的 url 写入 .git/config 里已 init 的条目
        if let Ok(mut sub) = repo.find_submodule(name) {
            let _ = sub.sync();
        }
        Ok(())
    }

    /// 返回 submodule 工作区的绝对路径，供前端作为新仓库打开
    pub fn submodule_workdir(path: &str, name: &str) -> GitResult<String> {
        let repo = Self::open(path)?;
        let sub = repo.find_submodule(name)?;
        let repo_workdir = repo
            .workdir()
            .ok_or_else(|| GitError::OperationFailed("仓库无工作区".to_string()))?;
        let abs = repo_workdir.join(sub.path());
        if !abs.exists() {
            return Err(GitError::OperationFailed(format!(
                "Submodule 工作区不存在：{}",
                abs.display()
            )));
        }
        Ok(abs.to_string_lossy().to_string())
    }

    /// 完整 deinit：
    /// 1. 删除 .git/modules/<name>
    /// 2. 删除 submodule 工作区目录
    /// 3. 从 .gitmodules 移除对应 section
    /// 4. 从 .git/config 移除对应 submodule.<name>.* 条目
    /// 5. 把 submodule 从父仓库 index 移除，并把 .gitmodules 重新 add
    pub fn deinit_submodule(path: &str, name: &str) -> GitResult<()> {
        Self::deinit_submodule_with(path, name, move_submodule_path_to_system_trash)
    }

    fn deinit_submodule_with<F>(path: &str, name: &str, mut move_to_trash: F) -> GitResult<()>
    where
        F: FnMut(&Path) -> GitResult<()>,
    {
        let repo = Self::open(path)?;
        let repo_workdir = repo
            .workdir()
            .ok_or_else(|| GitError::OperationFailed("仓库无工作区".to_string()))?
            .to_path_buf();

        // 读取 submodule path
        let sub_rel_path: PathBuf = {
            let sub = repo.find_submodule(name)?;
            sub.path().to_path_buf()
        };

        // 1. 将工作区和 .git/modules 元数据移入系统废纸篓。
        // 任一步失败都会在修改父仓库配置与 Index 之前停止。
        let workdir_path = repo_workdir.join(&sub_rel_path);
        let modules_dir = repo.path().join("modules").join(name);
        move_submodule_storage_to_trash_with(&workdir_path, &modules_dir, &mut move_to_trash)?;

        // 2. 重写 .gitmodules，剥离对应 section
        let gitmodules_path = repo_workdir.join(".gitmodules");
        let gitmodules_still_exists = gitmodules_path.exists();
        if gitmodules_still_exists {
            Self::strip_gitmodules_section(&gitmodules_path, name)?;
        }

        // 3. 从 .git/config 删除 submodule.<name>.* 条目
        if let Ok(mut config) = repo.config() {
            let prefix = format!("submodule.{}.", name);
            let mut keys_to_remove: Vec<String> = Vec::new();
            if let Ok(entries) = config.entries(None) {
                let _ = entries.for_each(|entry| {
                    if let Some(key) = entry.name() {
                        if key.starts_with(&prefix) {
                            keys_to_remove.push(key.to_string());
                        }
                    }
                });
            }
            for key in keys_to_remove {
                let _ = config.remove(&key);
            }
        }

        // 4. 更新 index：移除 submodule 条目，重新 add .gitmodules
        let mut index = repo.index()?;
        let _ = index.remove_path(&sub_rel_path);
        if gitmodules_still_exists {
            // .gitmodules 仍然存在（可能还有其他 submodule），重新 add
            let _ = index.add_path(Path::new(".gitmodules"));
        } else {
            let _ = index.remove_path(Path::new(".gitmodules"));
        }
        index.write()?;

        Ok(())
    }

    /// 添加 submodule 并 clone 其内容（等价于 `git submodule add <url> <path>`）。
    ///
    /// - `url`：远程 URL
    /// - `rel_path`：相对于仓库根目录的路径
    ///
    /// SSH URL 时 fallback 到系统 git（与 `update_submodule` 保持一致）。
    pub fn add_submodule(path: &str, url: &str, rel_path: &str) -> GitResult<()> {
        if is_ssh_url(url) {
            run_git(path, &["submodule", "add", url, rel_path])?;
            return Ok(());
        }

        let repo = Self::open(path)?;
        let mut sub = repo.submodule(url, Path::new(rel_path), true)?;

        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());
        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        let mut update_opts = git2::SubmoduleUpdateOptions::new();
        update_opts.fetch(fetch_opts);

        sub.clone(Some(&mut update_opts))?;
        sub.add_to_index(true)?;
        sub.add_finalize()?;
        Ok(())
    }

    fn strip_gitmodules_section(gitmodules_path: &Path, name: &str) -> GitResult<()> {
        let content = std::fs::read_to_string(gitmodules_path)
            .map_err(|e| GitError::OperationFailed(format!("读取 .gitmodules 失败：{}", e)))?;

        let target_header = format!("[submodule \"{}\"]", name);
        let mut out = String::with_capacity(content.len());
        let mut skipping = false;

        for line in content.lines() {
            let trimmed = line.trim_start();
            if trimmed.starts_with('[') {
                // 新的 section 开始：如果是目标则跳过；否则停止跳过
                if trimmed == target_header {
                    skipping = true;
                    continue;
                }
                skipping = false;
            }
            if skipping {
                continue;
            }
            out.push_str(line);
            out.push('\n');
        }

        // 如果整个文件变空（只剩空白 / 注释），删除文件
        let non_empty = out.lines().any(|l| {
            let t = l.trim();
            !t.is_empty() && !t.starts_with('#') && !t.starts_with(';')
        });

        if non_empty {
            std::fs::write(gitmodules_path, out)
                .map_err(|e| GitError::OperationFailed(format!("写入 .gitmodules 失败：{}", e)))?;
        } else {
            std::fs::remove_file(gitmodules_path)
                .map_err(|e| GitError::OperationFailed(format!("删除 .gitmodules 失败：{}", e)))?;
        }

        Ok(())
    }
}

fn move_submodule_path_to_system_trash(path: &Path) -> GitResult<()> {
    trash::delete(path).map_err(|error| {
        GitError::OperationFailed(format!(
            "无法将 Submodule 数据移入系统废纸篓 {}：{error}",
            path.display()
        ))
    })
}

fn move_submodule_storage_to_trash_with<F>(
    workdir_path: &Path,
    modules_dir: &Path,
    mut move_to_trash: F,
) -> GitResult<()>
where
    F: FnMut(&Path) -> GitResult<()>,
{
    for (label, path) in [("工作目录", workdir_path), ("内部 Git 元数据", modules_dir)] {
        if !path.exists() {
            continue;
        }
        move_to_trash(path).map_err(|error| {
            GitError::OperationFailed(format!(
                "无法回收 Submodule {label} {}：{error}",
                path.display()
            ))
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn submodule_storage_is_moved_to_recovery_locations() {
        let temp_dir = tempfile::tempdir().unwrap();
        let workdir = temp_dir.path().join("workdir/module");
        let modules = temp_dir.path().join("git/modules/module");
        let recovery = temp_dir.path().join("recovery");
        fs::create_dir_all(&workdir).unwrap();
        fs::create_dir_all(&modules).unwrap();
        fs::write(workdir.join("local.txt"), "uncommitted").unwrap();
        fs::write(modules.join("HEAD"), "ref: refs/heads/main").unwrap();
        fs::create_dir(&recovery).unwrap();
        let mut moved = 0;

        move_submodule_storage_to_trash_with(&workdir, &modules, |source| {
            let target = recovery.join(moved.to_string());
            moved += 1;
            fs::rename(source, target)?;
            Ok(())
        })
        .unwrap();

        assert_eq!(moved, 2);
        assert!(!workdir.exists());
        assert!(!modules.exists());
        assert_eq!(
            fs::read_to_string(recovery.join("0/local.txt")).unwrap(),
            "uncommitted"
        );
        assert!(recovery.join("1/HEAD").is_file());
    }

    #[test]
    fn submodule_storage_stops_before_any_move_when_workdir_trash_fails() {
        let temp_dir = tempfile::tempdir().unwrap();
        let workdir = temp_dir.path().join("workdir/module");
        let modules = temp_dir.path().join("git/modules/module");
        fs::create_dir_all(&workdir).unwrap();
        fs::create_dir_all(&modules).unwrap();

        let result = move_submodule_storage_to_trash_with(&workdir, &modules, |_| {
            Err(GitError::OperationFailed("trash unavailable".to_string()))
        });

        assert!(result.is_err());
        assert!(workdir.is_dir());
        assert!(modules.is_dir());
    }

    #[test]
    fn submodule_storage_stops_when_metadata_trash_fails() {
        let temp_dir = tempfile::tempdir().unwrap();
        let workdir = temp_dir.path().join("workdir/module");
        let modules = temp_dir.path().join("git/modules/module");
        let recovery = temp_dir.path().join("recovery");
        fs::create_dir_all(&workdir).unwrap();
        fs::create_dir_all(&modules).unwrap();
        let calls = std::cell::Cell::new(0);

        let result = move_submodule_storage_to_trash_with(&workdir, &modules, |source| {
            calls.set(calls.get() + 1);
            if calls.get() == 2 {
                return Err(GitError::OperationFailed("metadata busy".to_string()));
            }
            fs::rename(source, &recovery)?;
            Ok(())
        });

        assert!(result.is_err());
        assert_eq!(calls.get(), 2);
        assert!(recovery.is_dir());
        assert!(modules.is_dir());
    }

    #[test]
    fn deinit_keeps_parent_repository_entries_when_storage_trash_fails() {
        let temp_dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(temp_dir.path()).unwrap();
        let gitmodules = temp_dir.path().join(".gitmodules");
        let workdir = temp_dir.path().join("vendor/demo");
        let modules = repo.path().join("modules/vendor.demo");
        let manifest = "[submodule \"vendor.demo\"]\n\tpath = vendor/demo\n\turl = https://example.com/demo.git\n";
        fs::write(&gitmodules, manifest).unwrap();
        fs::create_dir_all(&workdir).unwrap();
        fs::create_dir_all(&modules).unwrap();
        repo.config()
            .unwrap()
            .set_str("submodule.vendor.demo.url", "https://example.com/demo.git")
            .unwrap();
        assert!(repo.find_submodule("vendor.demo").is_ok());

        let result = GitEngine::deinit_submodule_with(
            temp_dir.path().to_str().unwrap(),
            "vendor.demo",
            |_| Err(GitError::OperationFailed("trash unavailable".to_string())),
        );

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(gitmodules).unwrap(), manifest);
        assert_eq!(
            repo.config()
                .unwrap()
                .get_string("submodule.vendor.demo.url")
                .unwrap(),
            "https://example.com/demo.git"
        );
        assert!(workdir.is_dir());
        assert!(modules.is_dir());
    }
}
