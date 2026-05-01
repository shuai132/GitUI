use std::path::Path;

use crate::git::error::{GitError, GitResult};

use super::GitEngine;

impl GitEngine {
    // ── Amend ──────────────────────────────────────────────────────────

    /// 保留原 signature 的 name / email / timezone offset，只替换 Unix 秒数。
    /// 返回 `'static` lifetime 的 Signature（无借用 repo 生命期）。
    pub(crate) fn sig_with_time(
        orig: &git2::Signature<'_>,
        unix_secs: i64,
    ) -> GitResult<git2::Signature<'static>> {
        let t = git2::Time::new(unix_secs, orig.when().offset_minutes());
        Ok(git2::Signature::new(
            orig.name().unwrap_or(""),
            orig.email().unwrap_or(""),
            &t,
        )?)
    }

    /// 同 `sig_with_time`，但可额外覆盖 name / email。
    /// `name_override` / `email_override` 为 None 时保留 orig 中的原值。
    pub(crate) fn sig_with_overrides(
        orig: &git2::Signature<'_>,
        unix_secs: i64,
        name_override: Option<&str>,
        email_override: Option<&str>,
    ) -> GitResult<git2::Signature<'static>> {
        let t = git2::Time::new(unix_secs, orig.when().offset_minutes());
        Ok(git2::Signature::new(
            name_override.unwrap_or_else(|| orig.name().unwrap_or("")),
            email_override.unwrap_or_else(|| orig.email().unwrap_or("")),
            &t,
        )?)
    }

    /// 在当前 HEAD 上 amend 一次提交：用 index 里的 tree + 新 message 替换
    /// HEAD commit。返回新 commit OID。
    pub fn amend_commit(path: &str, message: &str) -> GitResult<String> {
        let repo = Self::open(path)?;
        if message.trim().is_empty() {
            return Err(GitError::OperationFailed("提交信息不能为空".to_string()));
        }
        let head = repo.head()?.peel_to_commit()?;
        let committer = repo.signature()?;
        let mut index = repo.index()?;
        index.write()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        // 保留原 author date，仅更新 committer 为当前时间
        let orig_author = head.author();
        let author = Self::sig_with_time(&orig_author, orig_author.when().seconds())?;
        let new_oid = head.amend(
            Some("HEAD"),
            Some(&author),
            Some(&committer),
            None,
            Some(message),
            Some(&tree),
        )?;
        Ok(new_oid.to_string())
    }

    /// 仅修改 HEAD commit 的 message（以及可选的时间戳 / author 信息），不改变 tree。
    /// - `author_time`：None = 保留原 author date；Some(t) = 覆盖为指定 Unix 秒
    /// - `committer_time`：None = 当前时间；Some(t) = 覆盖为指定 Unix 秒
    /// - `author_name` / `author_email`：None = 保留原值；Some(s) = 覆盖
    /// 返回新 commit OID。
    pub fn amend_commit_message(
        path: &str,
        message: &str,
        author_time: Option<i64>,
        committer_time: Option<i64>,
        author_name: Option<&str>,
        author_email: Option<&str>,
    ) -> GitResult<String> {
        let repo = Self::open(path)?;
        if message.trim().is_empty() {
            return Err(GitError::OperationFailed("提交信息不能为空".to_string()));
        }
        let head = repo.head()?.peel_to_commit()?;
        // committer：有指定时间则覆盖，否则用当前时间（repo.signature()）
        let committer_base = repo.signature()?;
        let committer = match committer_time {
            Some(t) => Self::sig_with_time(&committer_base, t)?,
            None => committer_base,
        };
        // author：name/email/time 任一有覆盖则用 sig_with_overrides；否则保留原值
        let orig_author = head.author();
        let author = Self::sig_with_overrides(
            &orig_author,
            author_time.unwrap_or_else(|| orig_author.when().seconds()),
            author_name,
            author_email,
        )?;
        let tree = head.tree()?;
        let new_oid = head.amend(
            Some("HEAD"),
            Some(&author),
            Some(&committer),
            None,
            Some(message),
            Some(&tree),
        )?;
        Ok(new_oid.to_string())
    }

    // ── Discard ────────────────────────────────────────────────────────

    /// 丢弃所有工作区变更 + untracked 文件。保持 HEAD 不动。
    /// 不删除 `.gitignore` 里的 ignored 文件。
    pub fn discard_all_changes(path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let mut cb = git2::build::CheckoutBuilder::new();
        cb.force().remove_untracked(true);
        repo.checkout_head(Some(&mut cb))?;
        Ok(())
    }

    /// 丢弃单个文件的未暂存变更（恢复工作区到 index）
    /// 若是 untracked 文件，会被移除。
    pub fn discard_file(path: &str, file_path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let mut index = repo.index()?;
        if index.get_path(Path::new(file_path), 0).is_none() {
            let workdir = repo
                .workdir()
                .ok_or_else(|| GitError::OperationFailed("仓库没有工作目录".to_string()))?;
            let target = workdir.join(file_path);
            if target.is_dir() {
                std::fs::remove_dir_all(&target)
                    .map_err(|e| GitError::OperationFailed(format!("删除未跟踪目录失败：{}", e)))?;
            } else if target.exists() {
                std::fs::remove_file(&target)
                    .map_err(|e| GitError::OperationFailed(format!("删除未跟踪文件失败：{}", e)))?;
            }
            return Ok(());
        }

        let mut cb = git2::build::CheckoutBuilder::new();
        cb.force().path(file_path);
        repo.checkout_index(Some(&mut index), Some(&mut cb))?;
        Ok(())
    }

    /// 还原一个 patch 到工作区（用于回滚 hunk）
    pub fn apply_patch(path: &str, patch_text: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let diff = git2::Diff::from_buffer(patch_text.as_bytes())?;
        let mut opts = git2::ApplyOptions::new();
        repo.apply(&diff, git2::ApplyLocation::WorkDir, Some(&mut opts))?;
        Ok(())
    }

    /// 将 patch 应用到 index（用于暂存 / 取消暂存 hunk）
    pub fn apply_patch_to_index(path: &str, patch_text: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let diff = git2::Diff::from_buffer(patch_text.as_bytes())?;
        let mut opts = git2::ApplyOptions::new();
        repo.apply(&diff, git2::ApplyLocation::Index, Some(&mut opts))?;
        Ok(())
    }

    /// 将 patch 同时应用到工作区和 index（用于放弃已暂存 hunk）
    pub fn apply_patch_to_workdir_and_index(path: &str, patch_text: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let diff = git2::Diff::from_buffer(patch_text.as_bytes())?;
        let mut opts = git2::ApplyOptions::new();
        repo.apply(&diff, git2::ApplyLocation::Both, Some(&mut opts))?;
        Ok(())
    }
}
