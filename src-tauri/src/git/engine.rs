use git2::{BranchType, Repository, RepositoryState, ResetType, Signature, StashFlags};
use std::path::Path;

use crate::git::{
    credentials::make_credentials_callback,
    encoding::{decode_commit_text, decode_ref_name},
    error::{GitError, GitResult},
    shellout::{get_remote_url, is_ssh_url, run_git},
    types::*,
};

mod diff;
mod history;
mod patch;
mod submodule;
mod workspace;

/// commit summary 取 message 第一行（trim）。
/// 自实现而不是 `Commit::summary_bytes()`，是因为我们已经按编码 hint 把 message
/// 解码成 String，从中切片更准也避免再走一次 git2 的内部解码。
fn summary_from(message: &str) -> String {
    message
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string()
}

/// 解码 commit message：用 `Commit::message_encoding()` header 作为 hint。
fn commit_message_decoded(commit: &git2::Commit<'_>) -> String {
    decode_commit_text(commit.message_bytes(), commit.message_encoding())
}

/// 解码 signature 的 name / email：用 commit hint。tag 上也复用同一编码。
fn signature_name(sig: &Signature<'_>, hint: Option<&str>) -> String {
    decode_commit_text(sig.name_bytes(), hint)
}
fn signature_email(sig: &Signature<'_>, hint: Option<&str>) -> String {
    decode_commit_text(sig.email_bytes(), hint)
}

/// 构造 `CommitInfo`，统一处理编码（message / summary / author 走同一 hint）。
fn build_commit_info(
    commit: &git2::Commit<'_>,
    parent_oids: Vec<String>,
    is_unreachable: bool,
    is_stash: bool,
    is_reflog_tip: bool,
) -> CommitInfo {
    let oid = commit.id();
    let hint = commit.message_encoding();
    let message = commit_message_decoded(commit);
    let summary = summary_from(&message);
    let author = commit.author();
    CommitInfo {
        oid: oid.to_string(),
        short_oid: oid.to_string()[..7].to_string(),
        message,
        summary,
        author_name: signature_name(&author, hint),
        author_email: signature_email(&author, hint),
        author_time: author.when().seconds(),
        time: commit.time().seconds(),
        parent_oids,
        is_unreachable,
        is_stash,
        is_reflog_tip,
    }
}

/// 二进制预览（图片等）最大读取字节数，超过则不返回原始字节。
pub const MAX_PREVIEW_BYTES: u64 = 10 * 1024 * 1024;
const LARGE_BLOB_THRESHOLD_BYTES: u64 = 1024 * 1024;

pub struct GitEngine;

impl GitEngine {
    pub fn open(path: &str) -> GitResult<Repository> {
        Repository::open(path).map_err(|e| GitError::RepoNotFound(e.message().to_string()))
    }

    pub fn list_branches(path: &str) -> GitResult<Vec<BranchInfo>> {
        let repo = Self::open(path)?;
        let head_ref = repo.head().ok();
        let head_name = head_ref
            .as_ref()
            .and_then(|h| h.shorthand())
            .map(|s| s.to_string());

        let mut branches = Vec::new();

        for branch_result in repo.branches(None)? {
            let (branch, branch_type) = branch_result?;
            let name = decode_ref_name(branch.name_bytes()?);
            let is_remote = branch_type == BranchType::Remote;

            // 跳过远程 HEAD 符号引用（如 origin/HEAD），它在 UI 中没有实际用途
            if is_remote && name.ends_with("/HEAD") {
                continue;
            }

            let is_head = !is_remote && head_name.as_deref() == Some(name.as_str());

            // 对本地分支尝试获取上游分支信息
            let upstream_branch = if !is_remote {
                branch.upstream().ok()
            } else {
                None
            };
            let upstream = upstream_branch
                .as_ref()
                .and_then(|u| u.name_bytes().ok().map(decode_ref_name));

            let local_oid = branch.get().peel_to_commit().ok().map(|c| c.id());
            let commit_oid = local_oid.map(|o| o.to_string());

            // 计算 ahead/behind（仅本地 && 有上游）
            let (ahead, behind) =
                if let (Some(local), Some(up)) = (local_oid, upstream_branch.as_ref()) {
                    match up.get().peel_to_commit() {
                        Ok(upstream_commit) => {
                            match repo.graph_ahead_behind(local, upstream_commit.id()) {
                                Ok((a, b)) => (Some(a as u32), Some(b as u32)),
                                Err(_) => (None, None),
                            }
                        }
                        Err(_) => (None, None),
                    }
                } else {
                    (None, None)
                };

            branches.push(BranchInfo {
                name,
                is_remote,
                is_head,
                upstream,
                commit_oid,
                ahead,
                behind,
            });
        }

        Ok(branches)
    }

    /// 基于远端分支的 commit 创建本地分支、可选设置上游并 checkout
    pub fn checkout_remote_branch(
        path: &str,
        remote_branch: &str,
        local_name: &str,
        track: bool,
    ) -> GitResult<()> {
        let repo = Self::open(path)?;

        // 找到远端分支并取得其 commit
        let remote_ref = repo
            .find_branch(remote_branch, BranchType::Remote)
            .map_err(|e| {
                GitError::OperationFailed(format!(
                    "找不到远端分支 {}: {}",
                    remote_branch,
                    e.message()
                ))
            })?;
        let commit = remote_ref
            .get()
            .peel_to_commit()
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;

        // 创建本地分支（若已存在则报错）
        let mut new_branch = repo
            .branch(local_name, &commit, false)
            .map_err(|e| GitError::OperationFailed(format!("创建本地分支失败: {}", e.message())))?;

        // 设置上游跟踪
        if track {
            new_branch
                .set_upstream(Some(remote_branch))
                .map_err(|e| GitError::OperationFailed(format!("设置上游失败: {}", e.message())))?;
        }

        // checkout
        let refname = format!("refs/heads/{}", local_name);
        let obj = repo
            .revparse_single(&refname)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        repo.checkout_tree(&obj, None)?;
        repo.set_head(&refname)?;
        Ok(())
    }

    pub fn create_branch(path: &str, name: &str, from_oid: Option<&str>) -> GitResult<()> {
        let repo = Self::open(path)?;
        let commit = if let Some(oid_str) = from_oid {
            let oid = git2::Oid::from_str(oid_str)
                .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
            repo.find_commit(oid)?
        } else {
            repo.head()?.peel_to_commit()?
        };
        repo.branch(name, &commit, false)?;
        Ok(())
    }

    pub fn switch_branch(path: &str, name: &str, force: bool) -> GitResult<()> {
        let repo = Self::open(path)?;
        let obj = repo
            .revparse_single(&format!("refs/heads/{}", name))
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let mut co = git2::build::CheckoutBuilder::new();
        if force {
            co.force();
        } else {
            co.safe();
        }
        repo.checkout_tree(&obj, Some(&mut co))?;
        repo.set_head(&format!("refs/heads/{}", name))?;
        Ok(())
    }

    pub fn delete_branch(path: &str, name: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let mut branch = repo.find_branch(name, BranchType::Local)?;
        branch.delete()?;
        Ok(())
    }

    // ── Tags ────────────────────────────────────────────────────────────

    /// 列出所有标签。
    ///
    /// 对每个 `refs/tags/*` 引用：
    /// - 尝试 `find_tag(oid)` → 成功即为附注标签，可读到 message / tagger / time
    /// - 失败则为轻量标签（ref 直接指向 commit）
    ///
    /// 返回结果按时间倒序（附注标签按 tagger time，轻量标签缺时间排到最后，
    /// 同组内按名字字母序）。
    pub fn list_tags(path: &str) -> GitResult<Vec<TagInfo>> {
        let repo = Self::open(path)?;
        let mut tags: Vec<TagInfo> = Vec::new();

        // tag_foreach 回调里只能借用 &repo（不能持有 Repository），所以在闭包里
        // 完成 find_tag / peel_to_commit，收集到局部 Vec 里。
        repo.tag_foreach(|oid, name_bytes| {
            // ref 名按 lossy 解码（git 规范要求 UTF-8，违规罕见但不要因此跳过整个 tag）
            let name_str = decode_ref_name(name_bytes);
            let short = name_str
                .strip_prefix("refs/tags/")
                .unwrap_or(&name_str)
                .to_string();

            // 先尝试 annotated
            if let Ok(tag_obj) = repo.find_tag(oid) {
                // target_id 可能还是另一个 tag（链式 annotated tag，极少见），
                // 统一再 peel 到 commit
                let commit_oid = repo
                    .find_object(tag_obj.target_id(), None)
                    .and_then(|o| o.peel_to_commit())
                    .map(|c| c.id().to_string())
                    .unwrap_or_else(|_| tag_obj.target_id().to_string());
                let tagger = tag_obj.tagger();
                // git2 0.19 未暴露 Tag::message_encoding，hint=None 走 UTF-8 试解 + chardetng
                let message = tag_obj.message_bytes().and_then(|b| {
                    let s = decode_commit_text(b, None).trim().to_string();
                    if s.is_empty() {
                        None
                    } else {
                        Some(s)
                    }
                });
                tags.push(TagInfo {
                    name: short,
                    commit_oid,
                    is_annotated: true,
                    message,
                    tagger_name: tagger.as_ref().map(|t| signature_name(t, None)),
                    time: tagger.as_ref().map(|t| t.when().seconds()),
                });
            } else {
                // 轻量标签：ref 直接指向 commit
                let commit_oid = repo
                    .find_object(oid, None)
                    .and_then(|o| o.peel_to_commit())
                    .map(|c| c.id().to_string())
                    .unwrap_or_else(|_| oid.to_string());
                tags.push(TagInfo {
                    name: short,
                    commit_oid,
                    is_annotated: false,
                    message: None,
                    tagger_name: None,
                    time: None,
                });
            }
            true
        })?;

        tags.sort_by(|a, b| match (a.time, b.time) {
            (Some(t1), Some(t2)) => t2.cmp(&t1),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.name.cmp(&b.name),
        });

        Ok(tags)
    }

    pub fn delete_tag(path: &str, name: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        repo.tag_delete(name)?;
        Ok(())
    }

    pub fn list_remote_tags(path: &str, remote_name: &str) -> GitResult<Vec<TagInfo>> {
        log::debug!("[engine::list_remote_tags] remote={remote_name}");

        let url = get_remote_url(path, remote_name)?;
        if is_ssh_url(&url) {
            let stdout = run_git(path, &["ls-remote", "--tags", remote_name])?;
            let mut map: std::collections::HashMap<String, TagInfo> =
                std::collections::HashMap::new();
            for line in stdout.lines() {
                if let Some((oid, refname)) = line.split_once('\t') {
                    if !refname.starts_with("refs/tags/") {
                        continue;
                    }
                    if refname.ends_with("^{}") {
                        let tag_name = refname["refs/tags/".len()..refname.len() - 3].to_string();
                        if let Some(tag) = map.get_mut(&tag_name) {
                            tag.commit_oid = oid.to_string();
                            tag.is_annotated = true;
                        } else {
                            map.insert(
                                tag_name.clone(),
                                TagInfo {
                                    name: tag_name,
                                    commit_oid: oid.to_string(),
                                    is_annotated: true,
                                    message: None,
                                    tagger_name: None,
                                    time: None,
                                },
                            );
                        }
                    } else {
                        let tag_name = refname["refs/tags/".len()..].to_string();
                        map.insert(
                            tag_name.clone(),
                            TagInfo {
                                name: tag_name,
                                commit_oid: oid.to_string(),
                                is_annotated: false,
                                message: None,
                                tagger_name: None,
                                time: None,
                            },
                        );
                    }
                }
            }
            log::debug!(
                "[engine::list_remote_tags] remote={remote_name} count={} (ssh cli)",
                map.len()
            );
            return Ok(map.into_values().collect());
        }

        let repo = Self::open(path)?;
        let mut remote = repo.find_remote(remote_name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());
        remote.connect_auth(git2::Direction::Fetch, Some(callbacks), None)?;
        let heads = remote.list()?;

        let mut map: std::collections::HashMap<String, TagInfo> = std::collections::HashMap::new();
        for head in heads {
            let name = head.name();
            if !name.starts_with("refs/tags/") {
                continue;
            }
            if name.ends_with("^{}") {
                let tag_name = name["refs/tags/".len()..name.len() - 3].to_string();
                if let Some(tag) = map.get_mut(&tag_name) {
                    tag.commit_oid = head.oid().to_string();
                    tag.is_annotated = true;
                } else {
                    map.insert(
                        tag_name.clone(),
                        TagInfo {
                            name: tag_name,
                            commit_oid: head.oid().to_string(),
                            is_annotated: true,
                            message: None,
                            tagger_name: None,
                            time: None,
                        },
                    );
                }
            } else {
                let tag_name = name["refs/tags/".len()..].to_string();
                map.insert(
                    tag_name.clone(),
                    TagInfo {
                        name: tag_name,
                        commit_oid: head.oid().to_string(),
                        is_annotated: false,
                        message: None,
                        tagger_name: None,
                        time: None,
                    },
                );
            }
        }
        let _ = remote.disconnect();
        log::debug!(
            "[engine::list_remote_tags] remote={remote_name} count={}",
            map.len()
        );
        Ok(map.into_values().collect())
    }

    // ── 提交级操作 ──────────────────────────────────────────────────────

    /// 检出指定提交（detached HEAD）
    pub fn checkout_commit(path: &str, oid: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let commit_oid = git2::Oid::from_str(oid)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let commit = repo.find_commit(commit_oid)?;
        let obj = commit.as_object();
        // safe 模式：有本地未提交变更时失败，保护用户工作
        let mut co = git2::build::CheckoutBuilder::new();
        co.safe();
        repo.checkout_tree(obj, Some(&mut co))?;
        repo.set_head_detached(commit_oid)?;
        Ok(())
    }

    /// Cherry-pick 指定提交到当前 HEAD
    /// - 无冲突：基于 index 创建新提交（作者沿用原提交，committer 是当前用户）
    /// - 有冲突：保留 CHERRY_PICK_HEAD，返回错误提示用户手动解决
    pub fn cherry_pick_commit(path: &str, oid: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let commit_oid = git2::Oid::from_str(oid)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let commit = repo.find_commit(commit_oid)?;
        repo.cherrypick(&commit, None)?;

        let mut index = repo.index()?;
        if index.has_conflicts() {
            return Err(GitError::OperationFailed(
                "Cherry-pick 出现冲突，请在工作区手动解决后提交".to_string(),
            ));
        }
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let head_commit = repo.head()?.peel_to_commit()?;
        let signature = repo.signature()?;
        // 复用原 commit message（按其自身 encoding 解码到 UTF-8）
        let message = commit_message_decoded(&commit);
        repo.commit(
            Some("HEAD"),
            &commit.author(),
            &signature,
            &message,
            &tree,
            &[&head_commit],
        )?;
        repo.cleanup_state()?;
        Ok(())
    }

    /// Revert 指定提交
    /// - 无冲突：自动创建 revert commit，message 为 'Revert "<original summary>"'
    /// - 有冲突：返回错误
    pub fn revert_commit(path: &str, oid: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let commit_oid = git2::Oid::from_str(oid)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let commit = repo.find_commit(commit_oid)?;
        repo.revert(&commit, None)?;

        let mut index = repo.index()?;
        if index.has_conflicts() {
            return Err(GitError::OperationFailed(
                "Revert 出现冲突，请在工作区手动解决后提交".to_string(),
            ));
        }
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let head_commit = repo.head()?.peel_to_commit()?;
        let signature = repo.signature()?;
        let original_summary = summary_from(&commit_message_decoded(&commit));
        let msg = format!(
            "Revert \"{}\"\n\nThis reverts commit {}.",
            original_summary,
            commit.id()
        );
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &msg,
            &tree,
            &[&head_commit],
        )?;
        repo.cleanup_state()?;
        Ok(())
    }

    /// 冲突解决后继续 cherry-pick：读 CHERRY_PICK_HEAD 还原原提交作者，创建新 commit。
    pub fn cherry_pick_continue(path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        if !matches!(
            repo.state(),
            RepositoryState::CherryPick | RepositoryState::CherryPickSequence
        ) {
            return Err(GitError::OperationFailed(
                "仓库当前不在 cherry-pick 状态".to_string(),
            ));
        }
        let mut index = repo.index()?;
        if index.has_conflicts() {
            return Err(GitError::OperationFailed("仍有未解决的冲突".to_string()));
        }
        let source_oid = read_single_oid_file(&repo.path().join("CHERRY_PICK_HEAD"))?;
        let source = repo.find_commit(source_oid)?;
        let head_commit = repo.head()?.peel_to_commit()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let signature = repo.signature()?;
        let message = read_trimmed_file(&repo.path().join("MERGE_MSG"))
            .unwrap_or_else(|| commit_message_decoded(&source));
        repo.commit(
            Some("HEAD"),
            &source.author(),
            &signature,
            &message,
            &tree,
            &[&head_commit],
        )?;
        repo.cleanup_state()?;
        Ok(())
    }

    /// 中止 cherry-pick：丢弃工作区/暂存区冲突改动并清理中间态。
    pub fn cherry_pick_abort(path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        if !matches!(
            repo.state(),
            RepositoryState::CherryPick | RepositoryState::CherryPickSequence
        ) {
            return Err(GitError::OperationFailed(
                "仓库当前不在 cherry-pick 状态".to_string(),
            ));
        }
        let head_commit = repo.head()?.peel_to_commit()?;
        repo.reset(head_commit.as_object(), ResetType::Hard, None)?;
        repo.cleanup_state()?;
        Ok(())
    }

    /// 冲突解决后继续 revert：读 REVERT_HEAD 创建 revert commit。
    pub fn revert_continue(path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        if !matches!(
            repo.state(),
            RepositoryState::Revert | RepositoryState::RevertSequence
        ) {
            return Err(GitError::OperationFailed(
                "仓库当前不在 revert 状态".to_string(),
            ));
        }
        let mut index = repo.index()?;
        if index.has_conflicts() {
            return Err(GitError::OperationFailed("仍有未解决的冲突".to_string()));
        }
        let source_oid = read_single_oid_file(&repo.path().join("REVERT_HEAD"))?;
        let source = repo.find_commit(source_oid)?;
        let head_commit = repo.head()?.peel_to_commit()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let signature = repo.signature()?;
        let message = read_trimmed_file(&repo.path().join("MERGE_MSG")).unwrap_or_else(|| {
            let original_summary = summary_from(&commit_message_decoded(&source));
            format!(
                "Revert \"{}\"\n\nThis reverts commit {}.",
                original_summary,
                source.id()
            )
        });
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &[&head_commit],
        )?;
        repo.cleanup_state()?;
        Ok(())
    }

    /// 中止 revert：丢弃工作区/暂存区冲突改动并清理中间态。
    pub fn revert_abort(path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        if !matches!(
            repo.state(),
            RepositoryState::Revert | RepositoryState::RevertSequence
        ) {
            return Err(GitError::OperationFailed(
                "仓库当前不在 revert 状态".to_string(),
            ));
        }
        let head_commit = repo.head()?.peel_to_commit()?;
        repo.reset(head_commit.as_object(), ResetType::Hard, None)?;
        repo.cleanup_state()?;
        Ok(())
    }

    /// Reset 当前 HEAD 到指定提交
    /// mode: "soft" | "mixed" | "hard"
    pub fn reset_to_commit(path: &str, oid: &str, mode: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let commit_oid = git2::Oid::from_str(oid)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let commit = repo.find_commit(commit_oid)?;
        let reset_type = match mode {
            "soft" => ResetType::Soft,
            "mixed" => ResetType::Mixed,
            "hard" => ResetType::Hard,
            _ => {
                return Err(GitError::OperationFailed(format!(
                    "未知的 reset 模式: {}",
                    mode
                )))
            }
        };
        repo.reset(commit.as_object(), reset_type, None)?;
        Ok(())
    }

    /// 在指定提交上创建标签
    /// - message = Some(非空) → 附注标签
    /// - message = None 或空字符串 → 轻量标签
    pub fn create_tag(path: &str, name: &str, oid: &str, message: Option<&str>) -> GitResult<()> {
        let repo = Self::open(path)?;
        let commit_oid = git2::Oid::from_str(oid)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let target = repo.find_object(commit_oid, None)?;
        match message {
            Some(msg) if !msg.is_empty() => {
                let signature = repo.signature()?;
                repo.tag(name, &target, &signature, msg, false)?;
            }
            _ => {
                repo.tag_lightweight(name, &target, false)?;
            }
        }
        Ok(())
    }

    pub fn fetch(path: &str, remote_name: &str) -> GitResult<()> {
        let url = get_remote_url(path, remote_name)?;
        if is_ssh_url(&url) {
            run_git(path, &["fetch", remote_name])?;
            return Ok(());
        }
        let repo = Self::open(path)?;
        let mut remote = repo.find_remote(remote_name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());
        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        remote.fetch(&[] as &[&str], Some(&mut fetch_opts), None)?;
        Ok(())
    }

    pub fn fetch_tags(path: &str, remote_name: &str) -> GitResult<()> {
        let url = get_remote_url(path, remote_name)?;
        if is_ssh_url(&url) {
            run_git(path, &["fetch", remote_name, "--tags"])?;
            return Ok(());
        }
        let repo = Self::open(path)?;
        let mut remote = repo.find_remote(remote_name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());
        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        fetch_opts.download_tags(git2::AutotagOption::All);
        remote.fetch(&[] as &[&str], Some(&mut fetch_opts), None)?;
        Ok(())
    }

    /// mode: "normal" | "force" | "force_with_lease"
    pub fn push(path: &str, remote_name: &str, branch_name: &str, mode: &str) -> GitResult<()> {
        log::debug!("[engine::push] mode={mode} remote={remote_name} branch={branch_name}");

        if mode == "force_with_lease" {
            run_git(
                path,
                &["push", "--force-with-lease", remote_name, branch_name],
            )?;
            return Ok(());
        }

        let refspec = if mode == "force" {
            format!("+refs/heads/{branch_name}:refs/heads/{branch_name}")
        } else {
            format!("refs/heads/{branch_name}:refs/heads/{branch_name}")
        };

        let url = get_remote_url(path, remote_name)?;
        if is_ssh_url(&url) {
            run_git(path, &["push", remote_name, &refspec])?;
            log::debug!("[engine::push] done (ssh cli)");
            return Ok(());
        }

        let repo = Self::open(path)?;
        let mut remote = repo.find_remote(remote_name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());
        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);
        log::debug!("[engine::push] pushing refspec={refspec}");
        remote.push(&[&refspec], Some(&mut push_opts))?;
        log::debug!("[engine::push] done");
        Ok(())
    }

    /// 推送一个本地 tag 到远端。refspec `refs/tags/<name>:refs/tags/<name>`。
    /// 不带 force：已存在同名远端 tag 时 git2 会返回 non-fast-forward 错误，
    /// 由前端错误映射（`errors.push.nonFastForward`）给出中文提示。
    pub fn push_tag(path: &str, remote_name: &str, tag_name: &str, force: bool) -> GitResult<()> {
        log::debug!("[engine::push_tag] remote={remote_name} tag={tag_name} force={force}");
        let refspec = if force {
            format!("+refs/tags/{name}:refs/tags/{name}", name = tag_name)
        } else {
            format!("refs/tags/{name}:refs/tags/{name}", name = tag_name)
        };

        let url = get_remote_url(path, remote_name)?;
        if is_ssh_url(&url) {
            run_git(path, &["push", remote_name, &refspec])?;
            return Ok(());
        }

        let repo = Self::open(path)?;
        let mut remote = repo.find_remote(remote_name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());
        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);
        remote.push(&[&refspec], Some(&mut push_opts))?;
        Ok(())
    }

    /// 删除远程 tag。使用系统 git 以简化 auth 和 ssh 处理。
    pub fn delete_remote_tag(path: &str, remote_name: &str, tag_name: &str) -> GitResult<()> {
        log::debug!("[engine::delete_remote_tag] remote={remote_name} tag={tag_name}");
        run_git(path, &["push", remote_name, "--delete", tag_name])?;
        Ok(())
    }

    /// 删除远程分支。使用系统 git。
    pub fn delete_remote_branch(path: &str, remote_name: &str, branch_name: &str) -> GitResult<()> {
        log::debug!("[engine::delete_remote_branch] remote={remote_name} branch={branch_name}");
        run_git(path, &["push", remote_name, "--delete", branch_name])?;
        Ok(())
    }

    pub fn pull(path: &str, remote_name: &str, branch_name: &str, mode: &str) -> GitResult<()> {
        log::debug!("[engine::pull] mode={mode} remote={remote_name} branch={branch_name}");

        let url = get_remote_url(path, remote_name)?;
        if is_ssh_url(&url) {
            log::debug!("[engine::pull] ssh fetch via system git");
            run_git(path, &["fetch", remote_name, branch_name])?;
        } else {
            let repo_fetch = Self::open(path)?;
            let mut remote = repo_fetch.find_remote(remote_name)?;
            let mut callbacks = git2::RemoteCallbacks::new();
            callbacks.credentials(make_credentials_callback());
            let mut fetch_opts = git2::FetchOptions::new();
            fetch_opts.remote_callbacks(callbacks);
            log::debug!("[engine::pull] fetching via libgit2...");
            remote.fetch(&[branch_name], Some(&mut fetch_opts), None)?;
        }

        let repo = Self::open(path)?;
        log::debug!("[engine::pull] fetch done, proceeding with mode={mode}");

        if mode == "rebase" {
            return Self::pull_rebase(&repo, branch_name);
        }

        // ff / ff_only: merge analysis
        let fetch_head = repo.find_reference("FETCH_HEAD")?;
        let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)?;
        let (merge_analysis, _) = repo.merge_analysis(&[&fetch_commit])?;

        if merge_analysis.is_up_to_date() {
            return Ok(());
        }

        if merge_analysis.is_fast_forward() {
            let refname = format!("refs/heads/{}", branch_name);
            let mut reference = repo.find_reference(&refname)?;
            reference.set_target(fetch_commit.id(), "Fast-forward")?;
            repo.set_head(&refname)?;
            repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
        } else if mode == "ff_only" {
            return Err(GitError::OperationFailed(
                "Cannot fast-forward: remote branch has diverged".to_string(),
            ));
        } else {
            // mode == "ff": 允许 merge commit（非快进时创建合并提交）
            return Self::pull_merge(&repo, branch_name, &fetch_commit);
        }

        Ok(())
    }

    /// Pull with rebase: fetch has already been done, now rebase HEAD onto FETCH_HEAD.
    fn pull_rebase(repo: &git2::Repository, branch_name: &str) -> GitResult<()> {
        // Check for dirty working tree
        let statuses = repo.statuses(Some(
            git2::StatusOptions::new()
                .include_untracked(false)
                .include_ignored(false),
        ))?;
        if !statuses.is_empty() {
            return Err(GitError::OperationFailed(
                "Cannot rebase: working tree has uncommitted changes. Commit or stash first."
                    .to_string(),
            ));
        }

        let fetch_head = repo.find_reference("FETCH_HEAD")?;
        let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)?;

        let head_ref = repo.head()?;
        let head_commit = repo.reference_to_annotated_commit(&head_ref)?;

        // Check if already up-to-date
        let (merge_analysis, _) = repo.merge_analysis(&[&fetch_commit])?;
        if merge_analysis.is_up_to_date() {
            return Ok(());
        }

        // If fast-forwardable, just do ff (no rebase needed)
        if merge_analysis.is_fast_forward() {
            let refname = format!("refs/heads/{}", branch_name);
            let mut reference = repo.find_reference(&refname)?;
            reference.set_target(fetch_commit.id(), "Fast-forward")?;
            repo.set_head(&refname)?;
            repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
            return Ok(());
        }

        // Perform rebase
        let mut rebase = repo.rebase(Some(&head_commit), Some(&fetch_commit), None, None)?;

        let sig = repo.signature()?;

        while let Some(op) = rebase.next() {
            let _op = op?;
            let index = repo.index()?;
            if index.has_conflicts() {
                rebase.abort()?;
                return Err(GitError::OperationFailed(
                    "Rebase conflict: please resolve conflicts manually in the terminal"
                        .to_string(),
                ));
            }
            rebase.commit(None, &sig, None)?;
        }

        rebase.finish(None)?;

        Ok(())
    }

    /// Pull 的 merge 路径：远端分叉时创建 merge commit（`mode == "ff"`）。
    ///
    /// 流程：
    /// 1. 检查工作区是否干净（有未提交变更则拒绝）
    /// 2. `repo.merge()` 执行三方合并并写入 index
    /// 3. 若 index 有冲突 → 保留 MERGE_HEAD 供用户手动解决，返回 conflict 错误
    /// 4. 无冲突 → 从 index 生成 tree → 创建 merge commit（两个 parent）→ 更新 HEAD
    fn pull_merge(
        repo: &git2::Repository,
        branch_name: &str,
        fetch_commit: &git2::AnnotatedCommit<'_>,
    ) -> GitResult<()> {
        // 1. 工作区干净检查
        let statuses = repo.statuses(Some(
            git2::StatusOptions::new()
                .include_untracked(false)
                .include_ignored(false),
        ))?;
        if !statuses.is_empty() {
            return Err(GitError::OperationFailed(
                "Cannot merge: working tree has uncommitted changes. Commit or stash first."
                    .to_string(),
            ));
        }

        // 2. 执行三方合并
        let mut merge_opts = git2::MergeOptions::new();
        merge_opts.fail_on_conflict(false);
        repo.merge(
            &[fetch_commit],
            Some(&mut merge_opts),
            Some(git2::build::CheckoutBuilder::default().allow_conflicts(true)),
        )?;

        // 3. 冲突检查
        let mut index = repo.index()?;
        if index.has_conflicts() {
            // 保留 MERGE_HEAD（用户需要在工作区手动解决冲突）
            return Err(GitError::OperationFailed(
                "Merge 出现冲突，请在工作区解决后继续".to_string(),
            ));
        }

        // 4. 生成 merge commit
        let sig = repo.signature()?;
        let tree_oid = index.write_tree_to(repo)?;
        let tree = repo.find_tree(tree_oid)?;

        let head_commit = repo.head()?.peel_to_commit()?;
        let fetch_commit_obj = repo.find_commit(fetch_commit.id())?;

        let message = format!("Merge remote-tracking branch 'origin/{}'", branch_name);

        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            &message,
            &tree,
            &[&head_commit, &fetch_commit_obj],
        )?;

        // 5. 清理合并状态（删除 MERGE_HEAD / MERGE_MSG 等）
        repo.cleanup_state()?;

        // 6. 确保工作目录与 HEAD 一致
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;

        log::debug!("[engine::pull_merge] merge commit created for branch={branch_name}");
        Ok(())
    }

    // ── Clone / Init ────────────────────────────────────────────────────
    ///
    /// - 凭据回调复用 `make_credentials_callback`（SSH agent / ed25519 / rsa / git helper）
    /// - `depth` 传 `Some(n>0)` 走浅克隆（libgit2 0.19+ 支持）
    /// - `recurse_submodules=true` 则在主仓库克隆完成后遍历 submodule 逐个 init+update
    /// - `on_progress(stage, percent, sideband_msg)`：
    ///     - stage = "receiving" / "indexing" / "checkout" / "sideband"
    ///     - "sideband" 的 percent 恒为 0，message 是服务器端原始文本
    ///
    /// 注意 transfer_progress 在大仓库里一秒会调几百次，节流应由调用方做（见
    /// `commands/repo.rs::clone_repo`），这里不节流以保持通用性。
    pub fn clone_repo(
        url: &str,
        target_path: &str,
        depth: Option<i32>,
        recurse_submodules: bool,
        on_progress: impl Fn(&str, u32, Option<String>) + Send + Sync + 'static,
    ) -> GitResult<String> {
        use std::sync::Arc;

        if is_ssh_url(url) {
            return Self::clone_repo_ssh(url, target_path, depth, recurse_submodules, on_progress);
        }

        let on_progress: Arc<dyn Fn(&str, u32, Option<String>) + Send + Sync> =
            Arc::new(on_progress);

        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());

        {
            let op = on_progress.clone();
            callbacks.transfer_progress(move |stats: git2::Progress<'_>| -> bool {
                let total = stats.total_objects();
                if total == 0 {
                    return true;
                }
                let received = stats.received_objects();
                if received < total {
                    let pct = ((received as u64) * 100 / (total as u64).max(1)) as u32;
                    op("receiving", pct, None);
                } else {
                    let indexed = stats.indexed_objects();
                    let pct = ((indexed as u64) * 100 / (total as u64).max(1)) as u32;
                    op("indexing", pct, None);
                }
                true
            });
        }

        {
            let op = on_progress.clone();
            callbacks.sideband_progress(move |data: &[u8]| -> bool {
                if let Ok(msg) = std::str::from_utf8(data) {
                    let trimmed = msg.trim();
                    if !trimmed.is_empty() {
                        op("sideband", 0, Some(trimmed.to_string()));
                    }
                }
                true
            });
        }

        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        if let Some(d) = depth {
            if d > 0 {
                fetch_opts.depth(d);
            }
        }

        let mut checkout = git2::build::CheckoutBuilder::new();
        {
            let op = on_progress.clone();
            checkout.progress(move |_path, completed, total| {
                if total == 0 {
                    return;
                }
                let pct = ((completed as u64) * 100 / (total as u64).max(1)) as u32;
                op("checkout", pct, None);
            });
        }

        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(fetch_opts);
        builder.with_checkout(checkout);

        let target = Path::new(target_path);
        let repo = builder.clone(url, target)?;

        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::OperationFailed("cloned repo has no workdir".to_string()))?
            .to_path_buf();

        if recurse_submodules {
            // 先收集 name 列表，避免持有 submodule iterator 再调 Self::... 时的借用冲突
            let names: Vec<String> = repo
                .submodules()?
                .iter()
                .map(|s| decode_ref_name(s.name_bytes()))
                .filter(|n| !n.is_empty())
                .collect();
            drop(repo);
            for name in names {
                Self::init_submodule(target_path, &name)?;
                Self::update_submodule(target_path, &name)?;
            }
        }

        Ok(workdir.to_string_lossy().to_string())
    }

    /// SSH URL 时走系统 `git clone`，stderr 流式解析驱动 `on_progress`。
    ///
    /// git clone 的 stderr 用 `\r` 刷新进度（`Receiving objects: 50% ...\r`），
    /// 用 `\n` 表示换行，所以逐字节读取、遇 `\r` 或 `\n` 冲缓冲一次。
    fn clone_repo_ssh(
        url: &str,
        target_path: &str,
        depth: Option<i32>,
        recurse_submodules: bool,
        on_progress: impl Fn(&str, u32, Option<String>),
    ) -> GitResult<String> {
        use std::io::Read;
        #[cfg(windows)]
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};

        let depth_str;
        let mut args: Vec<&str> = vec!["clone", "--progress"];
        if let Some(d) = depth {
            if d > 0 {
                depth_str = d.to_string();
                args.push("--depth");
                args.push(&depth_str);
            }
        }
        if recurse_submodules {
            args.push("--recurse-submodules");
        }
        args.push("--");
        args.push(url);
        args.push(target_path);

        let mut child_cmd = Command::new("git");
        child_cmd
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        child_cmd.creation_flags(0x08000000);
        let mut child = child_cmd.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                GitError::OperationFailed(
                    "git binary not found in PATH. SSH remotes require a system git install."
                        .to_string(),
                )
            } else {
                GitError::OperationFailed(format!("failed to spawn git clone: {e}"))
            }
        })?;

        let mut stderr = child.stderr.take().expect("stderr piped");
        let mut buf: Vec<u8> = Vec::with_capacity(256);
        let mut all_stderr: Vec<u8> = Vec::with_capacity(4096);
        let mut byte = [0u8; 1];

        loop {
            match stderr.read(&mut byte) {
                Ok(0) => break,
                Ok(_) => {
                    let c = byte[0];
                    all_stderr.push(c);
                    if c == b'\r' || c == b'\n' {
                        if !buf.is_empty() {
                            let line = String::from_utf8_lossy(&buf);
                            Self::parse_clone_progress(&line, &on_progress);
                            buf.clear();
                        }
                    } else {
                        buf.push(c);
                    }
                }
                Err(_) => break,
            }
        }
        if !buf.is_empty() {
            let line = String::from_utf8_lossy(&buf);
            Self::parse_clone_progress(&line, &on_progress);
        }

        let status = child
            .wait()
            .map_err(|e| GitError::OperationFailed(format!("waiting for git clone failed: {e}")))?;

        if !status.success() {
            let err_text = String::from_utf8_lossy(&all_stderr).trim().to_string();
            let msg = if err_text.is_empty() {
                format!("git clone failed (exit code {:?})", status.code())
            } else {
                err_text
            };
            return Err(GitError::OperationFailed(msg));
        }

        // 小/空仓库 git 可能不输出 "Updating files"，前端进度条需要一个收尾 100%
        on_progress("checkout", 100, None);

        // target_path 可能是相对路径，返回实际 workdir 让前端打开准确位置
        let target = Path::new(target_path);
        let abs = target
            .canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| target_path.to_string());
        Ok(abs)
    }

    fn parse_clone_progress(line: &str, on_progress: &impl Fn(&str, u32, Option<String>)) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return;
        }
        if let Some(rest) = trimmed.strip_prefix("remote: ") {
            on_progress("sideband", 0, Some(rest.to_string()));
            return;
        }
        let (stage, rest) = if let Some(r) = trimmed.strip_prefix("Receiving objects:") {
            ("receiving", r)
        } else if let Some(r) = trimmed.strip_prefix("Resolving deltas:") {
            ("indexing", r)
        } else if let Some(r) = trimmed.strip_prefix("Updating files:") {
            ("checkout", r)
        } else {
            return;
        };
        if let Some(pct_end) = rest.find('%') {
            let digits_start = rest[..pct_end]
                .rfind(|c: char| !c.is_ascii_digit())
                .map(|i| i + 1)
                .unwrap_or(0);
            if let Ok(pct) = rest[digits_start..pct_end].trim().parse::<u32>() {
                on_progress(stage, pct, None);
            }
        }
    }

    /// 在 `path` 上执行 `git init`（非 bare）。
    ///
    /// - 若路径不存在则先 `create_dir_all`
    /// - 若已经是 git 仓库则报错（避免静默覆盖用户现有仓库）
    /// - 不暴露 bare 选项：`open_repo` 当前不支持 bare，保持一致
    pub fn init_repo(path: &str) -> GitResult<()> {
        let p = Path::new(path);
        if p.exists() {
            if Repository::open(p).is_ok() {
                return Err(GitError::OperationFailed(
                    "already a git repository".to_string(),
                ));
            }
        } else {
            std::fs::create_dir_all(p)?;
        }
        Repository::init(p)?;
        Ok(())
    }

    pub fn list_remotes(path: &str) -> GitResult<Vec<RemoteInfo>> {
        let repo = Self::open(path)?;
        let remotes_list = repo.remotes()?;
        let mut result = Vec::new();
        for name_bytes in remotes_list.iter_bytes() {
            let name = decode_ref_name(name_bytes);
            if name.is_empty() {
                continue;
            }
            let url = repo
                .find_remote(&name)
                .ok()
                .and_then(|r| r.url().map(|s| s.to_string()));
            result.push(RemoteInfo { name, url });
        }
        Ok(result)
    }

    /// 添加一个新的 remote（等价于 `git remote add <name> <url>`）。
    /// 若 name 已存在则返回 OperationFailed。
    pub fn add_remote(path: &str, name: &str, url: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        repo.remote(name, url)?;
        Ok(())
    }

    /// 删除一个 remote，同时移除所有 remote-tracking refs（等价于 `git remote remove <name>`）。
    pub fn remove_remote(path: &str, name: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        repo.remote_delete(name)?;
        Ok(())
    }

    /// 修改 remote 的名称和/或 URL。
    pub fn edit_remote(path: &str, old_name: &str, new_name: &str, new_url: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        if old_name != new_name {
            repo.remote_rename(old_name, new_name)?;
        }
        repo.remote_set_url(new_name, new_url)?;
        Ok(())
    }

    // ── Stash ──────────────────────────────────────────────────────────

    /// Stash 当前工作区（包含未暂存的变更和 untracked 文件）
    pub fn stash_push(path: &str, message: Option<&str>) -> GitResult<()> {
        let mut repo = Self::open(path)?;
        let sig = repo.signature()?;
        let flags = StashFlags::INCLUDE_UNTRACKED;

        // 如果没有提供消息，生成简洁的 "WIP on {branch}" 格式
        let default_msg = if message.is_none() {
            let branch_name = repo
                .head()
                .ok()
                .and_then(|h| h.shorthand().map(|s| s.to_string()))
                .unwrap_or_else(|| "(no branch)".to_string());
            Some(format!("WIP on {}", branch_name))
        } else {
            None
        };

        let msg = message.or(default_msg.as_deref());
        repo.stash_save2(&sig, msg, Some(flags))?;
        Ok(())
    }

    /// Pop 指定 index 的 stash（默认 0 即最新一条）；成功后该 stash 被移除。
    pub fn stash_pop(path: &str, index: usize) -> GitResult<()> {
        let mut repo = Self::open(path)?;
        let count = Self::stash_count(&repo)?;
        if count == 0 {
            return Err(GitError::OperationFailed("没有可 pop 的 stash".to_string()));
        }
        if index >= count {
            return Err(GitError::OperationFailed(format!(
                "stash@{{{}}} 不存在（共 {} 条）",
                index, count
            )));
        }
        repo.stash_pop(index, None)?;
        Ok(())
    }

    /// Apply 指定 index 的 stash，应用后保留该 stash（不移除）。
    pub fn stash_apply(path: &str, index: usize) -> GitResult<()> {
        let mut repo = Self::open(path)?;
        let count = Self::stash_count(&repo)?;
        if count == 0 {
            return Err(GitError::OperationFailed(
                "没有可 apply 的 stash".to_string(),
            ));
        }
        if index >= count {
            return Err(GitError::OperationFailed(format!(
                "stash@{{{}}} 不存在（共 {} 条）",
                index, count
            )));
        }
        repo.stash_apply(index, None)?;
        Ok(())
    }

    /// 删除指定 index 的 stash（不 apply）。
    pub fn stash_drop(path: &str, index: usize) -> GitResult<()> {
        let mut repo = Self::open(path)?;
        let count = Self::stash_count(&repo)?;
        if count == 0 {
            return Err(GitError::OperationFailed("没有可删除的 stash".to_string()));
        }
        if index >= count {
            return Err(GitError::OperationFailed(format!(
                "stash@{{{}}} 不存在（共 {} 条）",
                index, count
            )));
        }
        repo.stash_drop(index)?;
        Ok(())
    }

    /// 枚举所有 stash —— 直接读 `refs/stash` reflog，语义与 libgit2 的
    /// `git_stash_foreach` 一致。绕开 `git2::Repository::stash_foreach`
    /// 是因为其内部 `CStr::from_ptr(msg).to_str().unwrap()` 会对非 UTF-8
    /// stash message 直接 panic（Windows 上 GBK 等编码常见），这个 panic
    /// 会跨 FFI 重新抛出并让 tokio worker 线程崩溃。
    fn list_stashes(repo: &Repository) -> GitResult<Vec<(usize, String, git2::Oid)>> {
        let reflog = match repo.reflog("refs/stash") {
            Ok(r) => r,
            Err(e) if e.code() == git2::ErrorCode::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut out = Vec::with_capacity(reflog.len());
        for (i, entry) in reflog.iter().enumerate() {
            let msg = entry
                .message_bytes()
                .map(|b| decode_commit_text(b, None))
                .unwrap_or_default();
            out.push((i, msg, entry.id_new()));
        }
        Ok(out)
    }

    fn stash_count(repo: &Repository) -> GitResult<usize> {
        Ok(Self::list_stashes(repo)?.len())
    }

    /// 列出所有 stash 条目
    pub fn stash_list(path: &str) -> GitResult<Vec<StashEntry>> {
        let repo = Self::open(path)?;
        Ok(Self::list_stashes(&repo)?
            .into_iter()
            .map(|(index, message, oid)| StashEntry {
                index,
                message,
                commit_oid: oid.to_string(),
            })
            .collect())
    }

    /// 读取 HEAD 的 reflog，返回最多 `limit` 条记录（最新在前）。
    pub fn get_reflog(path: &str, limit: usize) -> GitResult<Vec<ReflogEntry>> {
        let repo = Self::open(path)?;
        let reflog = repo
            .reflog("HEAD")
            .map_err(|e| GitError::OperationFailed(format!("读取 reflog 失败：{}", e)))?;

        let count = reflog.len().min(limit);
        let mut entries = Vec::with_capacity(count);

        for i in 0..count {
            let entry = reflog.get(i).unwrap();
            let oid = entry.id_new();
            let oid_str = oid.to_string();
            let short_oid = oid_str[..7.min(oid_str.len())].to_string();
            // reflog message 没有自己的 encoding header，按 commit 同等策略走自适应解码
            let message = entry
                .message_bytes()
                .map(|b| decode_commit_text(b, None))
                .unwrap_or_default();
            let committer = entry.committer();
            let committer_name = decode_commit_text(committer.name_bytes(), None);
            let time = committer.when().seconds();
            entries.push(ReflogEntry {
                oid: oid_str,
                short_oid,
                message,
                committer_name,
                time,
            });
        }

        Ok(entries)
    }

    /// 对仓库执行 `git gc`，返回命令输出文本。
    pub fn run_gc(path: &str) -> GitResult<String> {
        run_git(path, &["gc", "--quiet"])?;
        Ok("git gc 完成".to_string())
    }

    /// 计算"让 target 从 HEAD reflog 闭包里消失"所需要移除的 reflog entry 索引集合。
    ///
    /// 算法：对每个 HEAD reflog entry 的 `new_oid x`，当 `x == target` 或 target
    /// 是 x 的祖先（即从 x 出发 revwalk 能遇到 target）时，该 entry 被列入移除集合。
    /// 这样移除后，任何以 x 为起点的 revwalk 都不会再带出 target，前端视图也就
    /// 不再把 target 显示为 unreachable。
    ///
    /// 抽出独立函数供 `drop_unreachable_commit` 和 `preview_drop_unreachable_commit` 共用。
    fn compute_drop_unreachable_indices(
        repo: &Repository,
        reflog: &git2::Reflog,
        target: git2::Oid,
    ) -> Vec<usize> {
        let mut indices: Vec<usize> = Vec::new();
        for i in 0..reflog.len() {
            let Some(entry) = reflog.get(i) else { continue };
            let root = entry.id_new();
            if root == target {
                indices.push(i);
                continue;
            }
            // 判断 target 是否是 root 的祖先：从 root revwalk 看 target 能否被访问
            let Ok(mut walk) = repo.revwalk() else {
                continue;
            };
            if walk.push(root).is_err() {
                continue;
            }
            for anc in walk.flatten() {
                if anc == target {
                    indices.push(i);
                    break;
                }
            }
        }
        indices
    }

    /// 从 HEAD reflog 中移除让 `oid` 从 unreachable 视图消失所需的所有 entry（剥链）。
    ///
    /// 行为：
    /// - 对某条 reflog entry，其 `new_oid` 等于 target 或以 target 为祖先时命中，一并删除
    /// - 点 tip（没人把它当祖先）时只删自己；点链中/尾端时会带走所有后代的 reflog 入口
    /// - 对象本身仍留在 `.git/objects/`，由后续 `git gc` 按默认过期策略自然回收
    ///
    /// 返回实际删除的 entry 数（0 表示 reflog 里没有命中项，属幂等情形）。
    /// 不直接写回前可通过 `preview_drop_unreachable_commit` 提前取数，用作二次确认文案。
    pub fn drop_unreachable_commit(path: &str, oid: &str) -> GitResult<usize> {
        let repo = Self::open(path)?;
        let target = git2::Oid::from_str(oid)
            .map_err(|e| GitError::OperationFailed(format!("无效的 oid：{}", e)))?;
        let mut reflog = repo
            .reflog("HEAD")
            .map_err(|e| GitError::OperationFailed(format!("读取 reflog 失败：{}", e)))?;

        let indices = Self::compute_drop_unreachable_indices(&repo, &reflog, target);

        // 从末尾向前删避免索引失效；不重写前一条的 old_oid 链（rewrite_previous_entry = false），
        // 让 reflog 历史反映"entry 被移除"这件事本身，而不是伪造一段连贯的时间线。
        for &i in indices.iter().rev() {
            reflog
                .remove(i, false)
                .map_err(|e| GitError::OperationFailed(format!("移除 reflog 条目失败：{}", e)))?;
        }

        if !indices.is_empty() {
            reflog
                .write()
                .map_err(|e| GitError::OperationFailed(format!("写回 reflog 失败：{}", e)))?;
        }

        Ok(indices.len())
    }

    /// `drop_unreachable_commit` 的 dry-run：只计算将要被移除的 reflog entry 数，不实际写回。
    /// 供前端在二次确认对话框里显示影响范围（"将同时移除 N 条 reflog 引用"）。
    pub fn preview_drop_unreachable_commit(path: &str, oid: &str) -> GitResult<usize> {
        let repo = Self::open(path)?;
        let target = git2::Oid::from_str(oid)
            .map_err(|e| GitError::OperationFailed(format!("无效的 oid：{}", e)))?;
        let reflog = repo
            .reflog("HEAD")
            .map_err(|e| GitError::OperationFailed(format!("读取 reflog 失败：{}", e)))?;
        Ok(Self::compute_drop_unreachable_indices(&repo, &reflog, target).len())
    }
}

fn read_trimmed_file(p: &Path) -> Option<String> {
    std::fs::read_to_string(p)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// 读取单行 OID 文件（如 CHERRY_PICK_HEAD / REVERT_HEAD）。
fn read_single_oid_file(p: &Path) -> GitResult<git2::Oid> {
    let content = std::fs::read_to_string(p)
        .map_err(|e| GitError::OperationFailed(format!("读取 {} 失败：{e}", p.display())))?;
    let first = content.lines().next().unwrap_or("").trim();
    git2::Oid::from_str(first).map_err(|e| GitError::OperationFailed(e.message().to_string()))
}

/// 读取 `.git/rebase-merge/*` 或 `.git/rebase-apply/*` 下的 rebase 中间态。
/// 两套目录字段略有差异；返回 `(onto, orig_head, head_name, step, total, current_oid)`。
fn read_rebase_state(
    git_dir: &Path,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<u32>,
    Option<u32>,
    Option<String>,
) {
    let merge_dir = git_dir.join("rebase-merge");
    let apply_dir = git_dir.join("rebase-apply");
    let dir = if merge_dir.is_dir() {
        merge_dir
    } else if apply_dir.is_dir() {
        apply_dir
    } else {
        return (None, None, None, None, None, None);
    };

    let onto = read_trimmed_file(&dir.join("onto"));
    let orig_head =
        read_trimmed_file(&dir.join("orig-head")).or_else(|| read_trimmed_file(&dir.join("head")));
    let head_name = read_trimmed_file(&dir.join("head-name"));
    let current_oid = read_trimmed_file(&dir.join("stopped-sha"));

    // rebase-apply: msgnum + end；rebase-merge: msgnum（1-based 已完成步）/ end，
    // 或 done 文件行数 + git-rebase-todo 剩余行数（此处取 msgnum/end 足矣）
    let step = read_trimmed_file(&dir.join("msgnum")).and_then(|s| s.parse::<u32>().ok());
    let total = read_trimmed_file(&dir.join("end")).and_then(|s| s.parse::<u32>().ok());

    (onto, orig_head, head_name, step, total, current_oid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_utils::TestRepo;
    use git2::{Oid, StashFlags};
    use std::fs;

    fn checkout_branch(repo: &git2::Repository, name: &str) {
        repo.set_head(&format!("refs/heads/{name}")).unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
            .unwrap();
    }

    fn commit_file(test_repo: &TestRepo, message: &str, file_name: &str, content: &str) -> Oid {
        fs::write(test_repo.dir.path().join(file_name), content).unwrap();
        let repo = &test_repo.repo;
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file_name)).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let sig = repo.signature().unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])
            .unwrap()
    }

    fn commit_file_bytes(
        test_repo: &TestRepo,
        message: &str,
        file_name: &str,
        content: &[u8],
    ) -> Oid {
        fs::write(test_repo.dir.path().join(file_name), content).unwrap();
        let repo = &test_repo.repo;
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file_name)).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let sig = repo.signature().unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])
            .unwrap()
    }

    fn commit_file_to_ref(
        test_repo: &TestRepo,
        reference: &str,
        message: &str,
        file_name: &str,
        content: &str,
    ) -> Oid {
        fs::write(test_repo.dir.path().join(file_name), content).unwrap();
        let repo = &test_repo.repo;
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file_name)).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let sig = repo.signature().unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some(reference), &sig, &sig, message, &tree, &[&parent])
            .unwrap()
    }

    fn merge_commit(test_repo: &TestRepo, message: &str, parents: &[Oid]) -> Oid {
        fs::write(test_repo.dir.path().join("merge.txt"), message).unwrap();
        let repo = &test_repo.repo;
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("merge.txt")).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let sig = repo.signature().unwrap();
        let parent_commits = parents
            .iter()
            .map(|oid| repo.find_commit(*oid).unwrap())
            .collect::<Vec<_>>();
        let parent_refs = parent_commits.iter().collect::<Vec<_>>();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
            .unwrap()
    }

    fn multiline_base() -> String {
        (1..=14)
            .map(|i| format!("line{i}\n"))
            .collect::<Vec<_>>()
            .join("")
    }

    fn diff_contents(diff: &FileDiff) -> String {
        diff.hunks
            .iter()
            .flat_map(|h| h.lines.iter())
            .map(|l| l.content.as_str())
            .collect::<Vec<_>>()
            .join("")
    }

    #[test]
    fn test_apply_patch_to_index_stages_single_hunk() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let base = multiline_base();
        commit_file(&test_repo, "base", "existing.txt", &base);

        let modified = base
            .replace("line2\n", "LINE2\n")
            .replace("line12\n", "LINE12\n");
        fs::write(test_repo.dir.path().join("existing.txt"), modified).unwrap();

        let patch = concat!(
            "diff --git a/existing.txt b/existing.txt\n",
            "--- a/existing.txt\n",
            "+++ b/existing.txt\n",
            "@@ -1,5 +1,5 @@\n",
            " line1\n",
            "-line2\n",
            "+LINE2\n",
            " line3\n",
            " line4\n",
            " line5\n",
        );

        GitEngine::apply_patch_to_index(path, patch).unwrap();

        let staged = GitEngine::get_file_diff(path, "existing.txt", true).unwrap();
        let staged_content = diff_contents(&staged);
        assert!(staged_content.contains("LINE2\n"));
        assert!(!staged_content.contains("LINE12\n"));

        let unstaged = GitEngine::get_file_diff(path, "existing.txt", false).unwrap();
        let unstaged_content = diff_contents(&unstaged);
        assert!(!unstaged_content.contains("LINE2\n"));
        assert!(unstaged_content.contains("LINE12\n"));
    }

    #[test]
    fn test_apply_patch_to_index_unstages_single_hunk() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let base = multiline_base();
        commit_file(&test_repo, "base", "existing.txt", &base);

        let modified = base
            .replace("line2\n", "LINE2\n")
            .replace("line12\n", "LINE12\n");
        fs::write(test_repo.dir.path().join("existing.txt"), modified).unwrap();
        GitEngine::stage_file(path, "existing.txt").unwrap();

        let patch = concat!(
            "diff --git a/existing.txt b/existing.txt\n",
            "--- a/existing.txt\n",
            "+++ b/existing.txt\n",
            "@@ -1,5 +1,5 @@\n",
            " line1\n",
            "+line2\n",
            "-LINE2\n",
            " line3\n",
            " line4\n",
            " line5\n",
        );

        GitEngine::apply_patch_to_index(path, patch).unwrap();

        let staged = GitEngine::get_file_diff(path, "existing.txt", true).unwrap();
        let staged_content = diff_contents(&staged);
        assert!(!staged_content.contains("LINE2\n"));
        assert!(staged_content.contains("LINE12\n"));

        let unstaged = GitEngine::get_file_diff(path, "existing.txt", false).unwrap();
        let unstaged_content = diff_contents(&unstaged);
        assert!(unstaged_content.contains("LINE2\n"));
        assert!(!unstaged_content.contains("LINE12\n"));
    }

    #[test]
    fn test_discard_file_keeps_staged_changes() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let base = multiline_base();
        commit_file(&test_repo, "base", "existing.txt", &base);

        let staged = base.replace("line2\n", "LINE2\n");
        fs::write(test_repo.dir.path().join("existing.txt"), &staged).unwrap();
        GitEngine::stage_file(path, "existing.txt").unwrap();

        let unstaged = staged.replace("line12\n", "LINE12\n");
        fs::write(test_repo.dir.path().join("existing.txt"), unstaged).unwrap();

        GitEngine::discard_file(path, "existing.txt").unwrap();

        let worktree = fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap();
        assert!(worktree.contains("LINE2\n"));
        assert!(!worktree.contains("LINE12\n"));

        let status = GitEngine::get_status(path).unwrap();
        assert_eq!(status.staged.len(), 1);
        assert!(status.unstaged.is_empty());
    }

    #[test]
    fn test_discard_file_removes_untracked_file() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let target = test_repo.dir.path().join("new.txt");
        fs::write(&target, "new\n").unwrap();

        GitEngine::discard_file(path, "new.txt").unwrap();

        assert!(!target.exists());
    }

    #[test]
    fn test_apply_patch_to_workdir_and_index_discards_staged_hunk() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let base = multiline_base();
        commit_file(&test_repo, "base", "existing.txt", &base);

        let modified = base
            .replace("line2\n", "LINE2\n")
            .replace("line12\n", "LINE12\n");
        fs::write(test_repo.dir.path().join("existing.txt"), modified).unwrap();
        GitEngine::stage_file(path, "existing.txt").unwrap();

        let patch = concat!(
            "diff --git a/existing.txt b/existing.txt\n",
            "--- a/existing.txt\n",
            "+++ b/existing.txt\n",
            "@@ -1,5 +1,5 @@\n",
            " line1\n",
            "+line2\n",
            "-LINE2\n",
            " line3\n",
            " line4\n",
            " line5\n",
        );

        GitEngine::apply_patch_to_workdir_and_index(path, patch).unwrap();

        let staged = GitEngine::get_file_diff(path, "existing.txt", true).unwrap();
        let staged_content = diff_contents(&staged);
        assert!(!staged_content.contains("LINE2\n"));
        assert!(staged_content.contains("LINE12\n"));

        let worktree = fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap();
        assert!(!worktree.contains("LINE2\n"));
        assert!(worktree.contains("LINE12\n"));
    }

    #[test]
    fn test_stash_diff_includes_untracked_and_staged_new_files() {
        let mut test_repo = TestRepo::new();
        let path = test_repo.path_str().to_string(); // clone to avoid lifetime issues if we mutably borrow repo
        let repo = &mut test_repo.repo;

        // Create staged new file
        fs::write(
            test_repo.dir.path().join("staged_new.txt"),
            "staged content\n",
        )
        .unwrap();
        let mut index = repo.index().unwrap();
        index
            .add_path(std::path::Path::new("staged_new.txt"))
            .unwrap();
        index.write().unwrap();

        // Create untracked file (NOT staged)
        fs::write(
            test_repo.dir.path().join("untracked_new.txt"),
            "untracked content\n",
        )
        .unwrap();

        // Stash using libgit2 with INCLUDE_UNTRACKED
        let sig = repo.signature().unwrap();
        repo.stash_save2(
            &sig,
            Some("test stash"),
            Some(StashFlags::INCLUDE_UNTRACKED),
        )
        .unwrap();

        // Get the stash commit OID
        let stash_oid = {
            let reflog = repo.reflog("refs/stash").unwrap();
            reflog.get(0).unwrap().id_new()
        };

        // Test get_commit_detail
        let detail = GitEngine::get_commit_detail(&path, &stash_oid.to_string()).unwrap();

        let file_names: Vec<&str> = detail
            .diffs
            .iter()
            .filter_map(|d| d.new_path.as_deref())
            .collect();

        // Both files should appear
        assert!(
            file_names.contains(&"staged_new.txt"),
            "staged_new.txt should be in stash diff"
        );
        assert!(
            file_names.contains(&"untracked_new.txt"),
            "untracked_new.txt should be in stash diff"
        );

        // Verify hunks are not empty
        for diff in &detail.diffs {
            if diff.new_path.as_deref() == Some("existing.txt") {
                continue;
            }
            assert!(
                !diff.hunks.is_empty(),
                "File {:?} should have non-empty hunks (additions={})",
                diff.new_path,
                diff.additions
            );
        }
    }

    #[test]
    fn test_get_status() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();

        // Add untracked file
        fs::write(test_repo.dir.path().join("new_file.txt"), "hello gitui").unwrap();

        // Add modified file
        fs::write(test_repo.dir.path().join("existing.txt"), "hello modified").unwrap();

        let status = GitEngine::get_status(path).expect("Failed to get status");
        assert_eq!(status.untracked.len(), 1);
        assert_eq!(status.untracked[0].path, "new_file.txt");
        assert_eq!(status.untracked[0].additions, 0);
        assert_eq!(status.untracked[0].deletions, 0);

        assert_eq!(status.unstaged.len(), 1);
        assert_eq!(status.unstaged[0].path, "existing.txt");
        assert_eq!(status.unstaged[0].additions, 1);
        assert_eq!(status.unstaged[0].deletions, 1);
    }

    #[test]
    fn test_get_log() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();

        let log = GitEngine::get_log(path, 0, 10, false, false, LogBranchScope::All, true)
            .expect("Failed to get log");

        // At least the initial commit should exist
        assert_eq!(log.commits.len(), 1);
        assert_eq!(log.commits[0].summary, "init");

        GitEngine::create_commit(path, "second commit").unwrap();
        let log_after =
            GitEngine::get_log(path, 0, 10, false, false, LogBranchScope::All, true).unwrap();

        assert_eq!(log_after.commits.len(), 2);
        assert_eq!(log_after.commits[0].summary, "second commit");
    }

    #[test]
    fn test_get_log_can_exclude_remote_only_commits() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();

        let remote_oid = commit_file_to_ref(
            &test_repo,
            "refs/remotes/origin/feature",
            "remote only",
            "remote.txt",
            "remote\n",
        );

        let with_remote =
            GitEngine::get_log(path, 0, 10, false, false, LogBranchScope::All, true).unwrap();
        assert!(with_remote
            .commits
            .iter()
            .any(|c| c.oid == remote_oid.to_string()));

        let without_remote =
            GitEngine::get_log(path, 0, 10, false, false, LogBranchScope::All, false).unwrap();
        assert!(!without_remote
            .commits
            .iter()
            .any(|c| c.oid == remote_oid.to_string()));
    }

    #[test]
    fn test_get_log_current_first_parent_excludes_merged_side_branch() {
        let test_repo = TestRepo::new();
        let repo = &test_repo.repo;
        let path = test_repo.path_str();

        let main1 = commit_file(&test_repo, "main 1", "main1.txt", "main 1\n");
        repo.branch("side", &repo.find_commit(main1).unwrap(), false)
            .unwrap();

        checkout_branch(repo, "side");
        let side1 = commit_file(&test_repo, "side 1", "side1.txt", "side 1\n");
        let side2 = commit_file(&test_repo, "side 2", "side2.txt", "side 2\n");

        checkout_branch(repo, "master");
        let main2 = commit_file(&test_repo, "main 2", "main2.txt", "main 2\n");
        let merge = merge_commit(&test_repo, "merge side", &[main2, side2]);

        let log = GitEngine::get_log(
            path,
            0,
            20,
            false,
            false,
            LogBranchScope::CurrentFirstParent,
            true,
        )
        .unwrap();
        let oids = log
            .commits
            .iter()
            .map(|c| c.oid.as_str())
            .collect::<Vec<_>>();
        let merge_oid = merge.to_string();
        let main2_oid = main2.to_string();
        let main1_oid = main1.to_string();
        let side1_oid = side1.to_string();
        let side2_oid = side2.to_string();

        assert!(oids.contains(&merge_oid.as_str()));
        assert!(oids.contains(&main2_oid.as_str()));
        assert!(oids.contains(&main1_oid.as_str()));
        assert!(!oids.contains(&side1_oid.as_str()));
        assert!(!oids.contains(&side2_oid.as_str()));
    }

    #[test]
    fn test_get_commit_change_stats_for_root_and_text_commit() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let root_oid = test_repo
            .repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id();

        let text_oid = commit_file(&test_repo, "expand text", "existing.txt", "hello\nworld\n");

        let stats = GitEngine::get_commit_change_stats(
            path,
            vec![root_oid.to_string(), text_oid.to_string()],
        )
        .unwrap();

        assert_eq!(stats.len(), 2);
        assert_eq!(stats[0].oid, root_oid.to_string());
        assert_eq!(stats[0].files_changed, 1);
        assert_eq!(stats[0].additions, 1);
        assert_eq!(stats[0].deletions, 0);

        assert_eq!(stats[1].oid, text_oid.to_string());
        assert_eq!(stats[1].files_changed, 1);
        assert_eq!(stats[1].additions, 1);
        assert_eq!(stats[1].deletions, 0);
        assert_eq!(stats[1].binary_files, 0);
        assert_eq!(stats[1].large_blob_count, 0);
    }

    #[test]
    fn test_get_commit_change_stats_flags_binary_and_large_blob() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let bytes = vec![0u8; LARGE_BLOB_THRESHOLD_BYTES as usize + 1];
        let oid = commit_file_bytes(&test_repo, "add large binary", "large.bin", &bytes);

        let stats = GitEngine::get_commit_change_stats(path, vec![oid.to_string()]).unwrap();
        let item = &stats[0];

        assert_eq!(item.files_changed, 1);
        assert_eq!(item.binary_files, 1);
        assert_eq!(item.large_blob_count, 1);
        assert!(item.large_blob_bytes >= LARGE_BLOB_THRESHOLD_BYTES);
        assert!(item.largest_blob_bytes >= LARGE_BLOB_THRESHOLD_BYTES);
    }

    #[test]
    fn test_get_commit_change_stats_uses_first_parent_for_merge() {
        let test_repo = TestRepo::new();
        let repo = &test_repo.repo;
        let path = test_repo.path_str();

        let main1 = commit_file(&test_repo, "main 1", "main1.txt", "main 1\n");
        repo.branch("side", &repo.find_commit(main1).unwrap(), false)
            .unwrap();

        checkout_branch(repo, "side");
        let side = commit_file(&test_repo, "side", "side.txt", "side\n");

        checkout_branch(repo, "master");
        let main2 = commit_file(&test_repo, "main 2", "main2.txt", "main 2\n");
        let merge = merge_commit(&test_repo, "merge side", &[main2, side]);

        let stats = GitEngine::get_commit_change_stats(path, vec![merge.to_string()]).unwrap();
        let item = &stats[0];

        assert_eq!(item.files_changed, 1);
        assert_eq!(item.additions, 1);
        assert_eq!(item.deletions, 0);
    }
}
