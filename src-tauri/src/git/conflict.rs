//! 冲突文件的三方内容读取与解决标记。
//!
//! 冲突时 libgit2 的 index 会有 3 个 stage 条目：
//! - stage 1 = common ancestor（base）
//! - stage 2 = ours（HEAD 侧）
//! - stage 3 = theirs（merge 来源侧）
//!
//! 任一侧不存在（删除冲突）时对应 `IndexEntry` 为 None。

use git2::{IndexConflict, Repository};

use crate::git::{
    encoding::{decode_with, detect_file_encoding},
    engine::GitEngine,
    error::{GitError, GitResult},
    types::ConflictFile,
};

const BINARY_PROBE_BYTES: usize = 8000;

impl GitEngine {
    pub fn get_conflict_file(path: &str, file_path: &str) -> GitResult<ConflictFile> {
        let repo = Self::open(path)?;
        let index = repo.index()?;

        let conflict = find_conflict(&index, file_path)?;

        let base_bytes = conflict
            .ancestor
            .as_ref()
            .and_then(|e| read_blob(&repo, &e.id).ok());
        let ours_bytes = conflict
            .our
            .as_ref()
            .and_then(|e| read_blob(&repo, &e.id).ok());
        let theirs_bytes = conflict
            .their
            .as_ref()
            .and_then(|e| read_blob(&repo, &e.id).ok());

        // 工作区当前内容（含冲突标记）
        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::OperationFailed("裸仓库不支持冲突文件".to_string()))?;
        let disk = workdir.join(file_path);
        let disk_bytes = std::fs::read(&disk).unwrap_or_default();

        let is_binary = any_binary(&[
            base_bytes.as_deref(),
            ours_bytes.as_deref(),
            theirs_bytes.as_deref(),
            Some(&disk_bytes),
        ]);

        let mut merged_preview = String::new();
        let mut base = None;
        let mut ours = None;
        let mut theirs = None;

        if !is_binary {
            // 按文件确定编码：暂时不支持从 conflict 侧取 attr，直接探测磁盘内容
            let enc = detect_file_encoding(&disk_bytes, None, None);
            merged_preview = decode_with(enc, &disk_bytes);
            base = base_bytes.map(|b| decode_with(enc, &b));
            ours = ours_bytes.map(|b| decode_with(enc, &b));
            theirs = theirs_bytes.map(|b| decode_with(enc, &b));
        }

        Ok(ConflictFile {
            path: file_path.to_string(),
            base,
            ours,
            theirs,
            merged_preview,
            is_binary,
        })
    }

    /// 把解决后的内容写回工作区并标记为已解决（stage）。
    pub fn mark_conflict_resolved(
        path: &str,
        file_path: &str,
        content: &str,
    ) -> GitResult<()> {
        let repo = Self::open(path)?;
        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::OperationFailed("裸仓库不支持冲突文件".to_string()))?;
        let disk = workdir.join(file_path);
        if let Some(parent) = disk.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| GitError::OperationFailed(format!("创建目录失败：{e}")))?;
        }
        std::fs::write(&disk, content)
            .map_err(|e| GitError::OperationFailed(format!("写入文件失败：{e}")))?;

        let mut index = repo.index()?;
        // add_path 会把 stage 1/2/3 的 conflict 条目替换为 stage 0，等价于解决
        index.add_path(std::path::Path::new(file_path))?;
        index.write()?;
        Ok(())
    }

    /// 使用冲突的某一侧（ours 或 theirs）作为解决方案。
    pub fn checkout_conflict_side(
        path: &str,
        file_path: &str,
        side: &str,
    ) -> GitResult<()> {
        let repo = Self::open(path)?;
        let index = repo.index()?;
        let conflict = find_conflict(&index, file_path)?;

        let entry = match side {
            "ours" => conflict.our.as_ref(),
            "theirs" => conflict.their.as_ref(),
            other => {
                return Err(GitError::OperationFailed(format!(
                    "未知的冲突侧：{other}"
                )));
            }
        };
        let bytes = match entry {
            Some(e) => read_blob_raw(&repo, &e.id)?,
            None => {
                // 对应侧删除了该文件：移除工作区文件 + unstage
                let workdir = repo
                    .workdir()
                    .ok_or_else(|| GitError::OperationFailed("裸仓库不支持".to_string()))?;
                let disk = workdir.join(file_path);
                let _ = std::fs::remove_file(&disk);
                let mut idx = repo.index()?;
                idx.remove_path(std::path::Path::new(file_path)).ok();
                idx.write()?;
                return Ok(());
            }
        };

        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::OperationFailed("裸仓库不支持冲突文件".to_string()))?;
        let disk = workdir.join(file_path);
        if let Some(parent) = disk.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| GitError::OperationFailed(format!("创建目录失败：{e}")))?;
        }
        std::fs::write(&disk, &bytes)
            .map_err(|e| GitError::OperationFailed(format!("写入文件失败：{e}")))?;

        let mut idx = repo.index()?;
        idx.add_path(std::path::Path::new(file_path))?;
        idx.write()?;
        Ok(())
    }
}

fn find_conflict(index: &git2::Index, file_path: &str) -> GitResult<IndexConflict> {
    let conflicts = index.conflicts()?;
    for c in conflicts {
        let c = c?;
        let any_entry = c
            .ancestor
            .as_ref()
            .or(c.our.as_ref())
            .or(c.their.as_ref());
        if let Some(e) = any_entry {
            let p = std::str::from_utf8(&e.path).unwrap_or("");
            if p == file_path {
                return Ok(c);
            }
        }
    }
    Err(GitError::OperationFailed(format!(
        "未找到冲突文件：{file_path}"
    )))
}

fn read_blob(repo: &Repository, oid: &git2::Oid) -> GitResult<Vec<u8>> {
    read_blob_raw(repo, oid)
}

fn read_blob_raw(repo: &Repository, oid: &git2::Oid) -> GitResult<Vec<u8>> {
    let blob = repo.find_blob(*oid)?;
    Ok(blob.content().to_vec())
}

fn any_binary(sides: &[Option<&[u8]>]) -> bool {
    sides
        .iter()
        .filter_map(|s| *s)
        .any(|bytes| is_likely_binary(bytes))
}

fn is_likely_binary(bytes: &[u8]) -> bool {
    let len = bytes.len().min(BINARY_PROBE_BYTES);
    bytes[..len].contains(&0)
}
