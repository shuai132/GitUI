use git2::{BranchType, Repository, RepositoryState, ResetType};

use crate::git::{
    credentials::make_credentials_callback,
    encoding::{decode_commit_text, decode_ref_name},
    error::{GitError, GitResult},
    shellout::{get_remote_url, is_ssh_url, run_git},
    types::*,
};

use super::{
    commit_message_decoded, read_single_oid_file, read_trimmed_file, signature_name, summary_from,
    GitEngine,
};

impl GitEngine {
    pub(crate) fn ensure_expected_head(
        repo: &Repository,
        expected_head: Option<&str>,
        expected_head_ref: Option<&str>,
    ) -> GitResult<()> {
        if expected_head.is_none() && expected_head_ref.is_none() {
            return Ok(());
        }
        match repo.head() {
            Ok(head) => {
                let current_ref = head.name().unwrap_or("HEAD");
                let current = head.peel_to_commit()?.id().to_string();
                // expected_head=None + expected_head_ref=Some(...) means the caller
                // explicitly confirmed an unborn branch, not "any OID".
                let oid_changed = expected_head
                    .map(|expected| current != expected)
                    .unwrap_or(expected_head_ref.is_some());
                let ref_changed = expected_head_ref.is_some_and(|expected| current_ref != expected);
                if oid_changed || ref_changed {
                    return Err(GitError::OperationFailed(format!(
                        "Confirmed Git action context changed: expected HEAD {} at {}, current {current} at {current_ref}",
                        expected_head.unwrap_or("(unborn)"),
                        expected_head_ref.unwrap_or("(any)"),
                    )));
                }
            }
            Err(error) if error.code() == git2::ErrorCode::UnbornBranch => {
                let current_ref = repo
                    .find_reference("HEAD")?
                    .symbolic_target()
                    .unwrap_or("HEAD")
                    .to_string();
                let oid_changed = expected_head.is_some();
                let ref_changed = expected_head_ref.is_some_and(|expected| current_ref != expected);
                if oid_changed || ref_changed {
                    return Err(GitError::OperationFailed(format!(
                        "Confirmed Git action context changed: expected HEAD {} at {}, current unborn HEAD at {current_ref}",
                        expected_head.unwrap_or("(unborn)"),
                        expected_head_ref.unwrap_or("(any)"),
                    )));
                }
            }
            Err(error) => return Err(error.into()),
        }
        Ok(())
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
                .and_then(|u| u.name_bytes().ok().map(decode_ref_name))
                .or_else(|| {
                    if is_remote {
                        return None;
                    }
                    Self::configured_upstream(&repo, &name)
                });

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

    pub fn delete_branch(path: &str, name: &str, expected_oid: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let mut branch = repo.find_branch(name, BranchType::Local)?;
        let current = branch.get().target().ok_or_else(|| {
            GitError::OperationFailed(format!(
                "Branch target changed: refs/heads/{name} is not a direct reference"
            ))
        })?;
        if current.to_string() != expected_oid {
            return Err(GitError::OperationFailed(format!(
                "Branch target changed: expected {expected_oid}, current {current}"
            )));
        }
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
                    ref_oid: oid.to_string(),
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
                    ref_oid: oid.to_string(),
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

    pub fn delete_tag(path: &str, name: &str, expected_oid: Option<&str>) -> GitResult<()> {
        let repo = Self::open(path)?;
        if let Some(expected) = expected_oid {
            let reference = repo.find_reference(&format!("refs/tags/{name}"))?;
            let current = reference.target().ok_or_else(|| {
                GitError::OperationFailed(format!(
                    "Tag target changed: refs/tags/{name} is not a direct reference"
                ))
            })?;
            if current.to_string() != expected {
                return Err(GitError::OperationFailed(format!(
                    "Tag target changed: expected {expected}, current {current}"
                )));
            }
        }
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
                                    ref_oid: String::new(),
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
                        let entry = map.entry(tag_name.clone()).or_insert_with(|| TagInfo {
                            name: tag_name,
                            ref_oid: oid.to_string(),
                            commit_oid: oid.to_string(),
                            is_annotated: false,
                            message: None,
                            tagger_name: None,
                            time: None,
                        });
                        entry.ref_oid = oid.to_string();
                        if !entry.is_annotated {
                            entry.commit_oid = oid.to_string();
                        }
                    }
                }
            }
            for tag in map.values_mut() {
                if tag.ref_oid.is_empty() {
                    tag.ref_oid.clone_from(&tag.commit_oid);
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
                            ref_oid: String::new(),
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
                let entry = map.entry(tag_name.clone()).or_insert_with(|| TagInfo {
                    name: tag_name,
                    ref_oid: head.oid().to_string(),
                    commit_oid: head.oid().to_string(),
                    is_annotated: false,
                    message: None,
                    tagger_name: None,
                    time: None,
                });
                entry.ref_oid = head.oid().to_string();
                if !entry.is_annotated {
                    entry.commit_oid = head.oid().to_string();
                }
            }
        }
        for tag in map.values_mut() {
            if tag.ref_oid.is_empty() {
                tag.ref_oid.clone_from(&tag.commit_oid);
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
    pub fn checkout_commit(
        path: &str,
        oid: &str,
        expected_head: Option<&str>,
        expected_head_ref: Option<&str>,
    ) -> GitResult<()> {
        let repo = Self::open(path)?;
        Self::ensure_expected_head(&repo, expected_head, expected_head_ref)?;
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
    pub fn cherry_pick_commit(
        path: &str,
        oid: &str,
        expected_head: Option<&str>,
        expected_head_ref: Option<&str>,
    ) -> GitResult<()> {
        let repo = Self::open(path)?;
        Self::ensure_expected_head(&repo, expected_head, expected_head_ref)?;
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
    pub fn revert_commit(
        path: &str,
        oid: &str,
        expected_head: Option<&str>,
        expected_head_ref: Option<&str>,
    ) -> GitResult<()> {
        let repo = Self::open(path)?;
        Self::ensure_expected_head(&repo, expected_head, expected_head_ref)?;
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
    pub fn reset_to_commit(
        path: &str,
        oid: &str,
        mode: &str,
        expected_head: Option<&str>,
        expected_head_ref: Option<&str>,
    ) -> GitResult<()> {
        let repo = Self::open(path)?;
        Self::ensure_expected_head(&repo, expected_head, expected_head_ref)?;
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

    /// 撤销当前分支刚创建且尚未发布的单父提交。
    ///
    /// `expected_head` 是前端创建提交后记录的 OID。校验与 reset 在同一次仓库
    /// 打开中完成，避免 UI 状态过期时误把后来产生的提交一并回退。
    pub fn undo_last_commit(path: &str, expected_head: &str) -> GitResult<String> {
        let repo = Self::open(path)?;
        if repo.state() != RepositoryState::Clean {
            return Err(GitError::OperationFailed(
                "仓库正在执行其他 Git 操作，无法撤销提交".to_string(),
            ));
        }

        let expected_oid = git2::Oid::from_str(expected_head)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let head = repo.head()?;
        if !head.is_branch() {
            return Err(GitError::OperationFailed(
                "游离 HEAD 下不能撤销最近提交".to_string(),
            ));
        }

        let head_commit = head.peel_to_commit()?;
        if head_commit.id() != expected_oid {
            return Err(GitError::OperationFailed(
                "HEAD 已变化，不能撤销过期的提交".to_string(),
            ));
        }
        if head_commit.parent_count() != 1 {
            return Err(GitError::OperationFailed(
                "只能撤销具有一个父提交的普通提交".to_string(),
            ));
        }

        let branch_name = head
            .shorthand()
            .ok_or_else(|| GitError::OperationFailed("无法识别当前本地分支".to_string()))?;
        if let Ok(upstream) = repo
            .find_branch(branch_name, BranchType::Local)
            .and_then(|branch| branch.upstream())
        {
            if let Ok(upstream_commit) = upstream.get().peel_to_commit() {
                let upstream_oid = upstream_commit.id();
                let published = upstream_oid == expected_oid
                    || repo
                        .graph_descendant_of(upstream_oid, expected_oid)
                        .unwrap_or(false);
                if published {
                    return Err(GitError::OperationFailed(
                        "提交已发布到上游，请使用 Revert 保留共享历史".to_string(),
                    ));
                }
            }
        }

        let parent = head_commit.parent(0)?;
        let parent_oid = parent.id().to_string();
        repo.reset(parent.as_object(), ResetType::Mixed, None)?;
        Ok(parent_oid)
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
}
