use git2::{
    BranchType, DiffFormat, DiffOptions, Repository, RepositoryState, ResetType, StashFlags,
    StatusOptions, SubmoduleIgnore, SubmoduleStatus,
};
use std::path::{Path, PathBuf};

use crate::git::{
    credentials::credential_callback,
    error::{GitError, GitResult},
    types::*,
};

pub struct GitEngine;

impl GitEngine {
    pub fn open(path: &str) -> GitResult<Repository> {
        Repository::open(path).map_err(|e| GitError::RepoNotFound(e.message().to_string()))
    }

    pub fn get_status(path: &str) -> GitResult<WorkspaceStatus> {
        let repo = Self::open(path)?;

        let mut opts = StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false)
            .update_index(true);

        let statuses = repo.statuses(Some(&mut opts))?;

        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        let mut untracked = Vec::new();

        for entry in statuses.iter() {
            let status = entry.status();
            let path_str = entry.path().unwrap_or("").to_string();

            // Staged changes (index)
            if status.is_index_new() {
                staged.push(FileEntry {
                    path: path_str.clone(),
                    old_path: None,
                    status: FileStatusKind::Added,
                    staged: true,
                });
            } else if status.is_index_modified() {
                staged.push(FileEntry {
                    path: path_str.clone(),
                    old_path: None,
                    status: FileStatusKind::Modified,
                    staged: true,
                });
            } else if status.is_index_deleted() {
                staged.push(FileEntry {
                    path: path_str.clone(),
                    old_path: None,
                    status: FileStatusKind::Deleted,
                    staged: true,
                });
            } else if status.is_index_renamed() {
                let old_path = entry
                    .head_to_index()
                    .and_then(|d| d.old_file().path())
                    .map(|p| p.to_string_lossy().to_string());
                staged.push(FileEntry {
                    path: path_str.clone(),
                    old_path,
                    status: FileStatusKind::Renamed,
                    staged: true,
                });
            }

            // Unstaged changes (working tree)
            if status.is_wt_modified() {
                unstaged.push(FileEntry {
                    path: path_str.clone(),
                    old_path: None,
                    status: FileStatusKind::Modified,
                    staged: false,
                });
            } else if status.is_wt_deleted() {
                unstaged.push(FileEntry {
                    path: path_str.clone(),
                    old_path: None,
                    status: FileStatusKind::Deleted,
                    staged: false,
                });
            } else if status.is_wt_new() {
                untracked.push(FileEntry {
                    path: path_str.clone(),
                    old_path: None,
                    status: FileStatusKind::Untracked,
                    staged: false,
                });
            } else if status.is_conflicted() {
                unstaged.push(FileEntry {
                    path: path_str.clone(),
                    old_path: None,
                    status: FileStatusKind::Conflicted,
                    staged: false,
                });
            }
        }

        // Get HEAD info
        let (head_branch, head_commit, is_detached) = match repo.head() {
            Ok(head) => {
                let commit_oid = head
                    .peel_to_commit()
                    .ok()
                    .map(|c| c.id().to_string());
                if head.is_branch() {
                    let branch_name = head
                        .shorthand()
                        .map(|s| s.to_string());
                    (branch_name, commit_oid, false)
                } else {
                    (None, commit_oid, true)
                }
            }
            Err(_) => (None, None, false),
        };

        Ok(WorkspaceStatus {
            staged,
            unstaged,
            untracked,
            head_branch,
            head_commit,
            is_detached,
        })
    }

    pub fn stage_file(path: &str, file_path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let mut index = repo.index()?;
        index.add_path(std::path::Path::new(file_path))?;
        index.write()?;
        Ok(())
    }

    pub fn unstage_file(path: &str, file_path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let head = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .map(|c| c.into_object());

        match head {
            Some(head_obj) => {
                repo.reset_default(Some(&head_obj), [file_path])?;
            }
            None => {
                // No commits yet - remove from index
                let mut index = repo.index()?;
                index.remove_path(std::path::Path::new(file_path))?;
                index.write()?;
            }
        }
        Ok(())
    }

    pub fn stage_all(path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let mut index = repo.index()?;
        index.add_all(["*"], git2::IndexAddOption::DEFAULT, None)?;
        index.write()?;
        Ok(())
    }

    pub fn unstage_all(path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let head = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .map(|c| c.into_object());

        match head {
            Some(head_obj) => {
                repo.reset(&head_obj, ResetType::Mixed, None)?;
            }
            None => {
                let mut index = repo.index()?;
                index.clear()?;
                index.write()?;
            }
        }
        Ok(())
    }

    pub fn create_commit(path: &str, message: &str) -> GitResult<String> {
        let repo = Self::open(path)?;

        let sig = repo.signature()?;
        let mut index = repo.index()?;
        index.write()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;

        let parent_commits = match repo.head() {
            Ok(head) => {
                let commit = head.peel_to_commit()?;
                vec![commit]
            }
            Err(_) => vec![],
        };

        let parent_refs: Vec<&git2::Commit> = parent_commits.iter().collect();

        let commit_oid = repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            message,
            &tree,
            &parent_refs,
        )?;

        Ok(commit_oid.to_string())
    }

    pub fn get_log(
        path: &str,
        offset: usize,
        limit: usize,
        include_unreachable: bool,
        include_stashes: bool,
    ) -> GitResult<LogPage> {
        use std::collections::HashSet;

        let mut repo = Self::open(path)?;

        // ── Step A: 收集所有 ref 可达的 oid 集合（用于判断 unreachable）
        let mut reachable: HashSet<git2::Oid> = HashSet::new();
        {
            let mut walk = repo.revwalk()?;
            walk.push_glob("refs/heads/*").ok();
            walk.push_glob("refs/remotes/*").ok();
            walk.push_glob("refs/tags/*").ok();
            walk.push_head().ok();
            for oid_result in walk {
                if let Ok(oid) = oid_result {
                    reachable.insert(oid);
                }
            }
        }

        // ── Step B: 收集所有 stash 的 oid 集合
        let mut stash_set: HashSet<git2::Oid> = HashSet::new();
        repo.stash_foreach(|_, _, oid| {
            stash_set.insert(*oid);
            true
        })
        .ok();

        // ── Step C: 主 revwalk —— 推所有 ref + 可选 stash + 可选 reflog
        let mut revwalk = repo.revwalk()?;
        revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;
        revwalk.push_glob("refs/heads/*").ok();
        revwalk.push_glob("refs/remotes/*").ok();
        revwalk.push_glob("refs/tags/*").ok();
        revwalk.push_head().ok();

        if include_stashes {
            for oid in &stash_set {
                revwalk.push(*oid).ok();
            }
        }

        if include_unreachable {
            // 遍历 HEAD reflog，把不在 reachable 也不在 stash 集合里的 oid 推入
            if let Ok(reflog) = repo.reflog("HEAD") {
                for entry in reflog.iter() {
                    let oid = entry.id_new();
                    if !reachable.contains(&oid) && !stash_set.contains(&oid) {
                        revwalk.push(oid).ok();
                    }
                }
            }
        }

        let mut commits = Vec::new();
        let mut idx = 0;
        let mut has_more = false;

        for oid_result in revwalk {
            let oid = oid_result?;
            if idx < offset {
                idx += 1;
                continue;
            }
            if commits.len() >= limit {
                has_more = true;
                break;
            }
            let commit = repo.find_commit(oid)?;
            let parent_oids = commit.parent_ids().map(|p| p.to_string()).collect();

            let is_stash = stash_set.contains(&oid);
            let is_unreachable = !is_stash && !reachable.contains(&oid);

            commits.push(CommitInfo {
                oid: oid.to_string(),
                short_oid: oid.to_string()[..7].to_string(),
                message: commit.message().unwrap_or("").to_string(),
                summary: commit.summary().unwrap_or("").to_string(),
                author_name: commit.author().name().unwrap_or("").to_string(),
                author_email: commit.author().email().unwrap_or("").to_string(),
                time: commit.time().seconds(),
                parent_oids,
                is_unreachable,
                is_stash,
            });
            idx += 1;
        }

        let total_loaded = offset + commits.len();
        Ok(LogPage {
            commits,
            has_more,
            total_loaded,
        })
    }

    pub fn get_commit_detail(path: &str, oid_str: &str) -> GitResult<CommitDetail> {
        let repo = Self::open(path)?;
        let oid = git2::Oid::from_str(oid_str)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let commit = repo.find_commit(oid)?;

        let parent_oids = commit.parent_ids().map(|p| p.to_string()).collect();
        let info = CommitInfo {
            oid: oid.to_string(),
            short_oid: oid.to_string()[..7].to_string(),
            message: commit.message().unwrap_or("").to_string(),
            summary: commit.summary().unwrap_or("").to_string(),
            author_name: commit.author().name().unwrap_or("").to_string(),
            author_email: commit.author().email().unwrap_or("").to_string(),
            time: commit.time().seconds(),
            parent_oids,
            is_unreachable: false,
            is_stash: false,
        };

        let diff = if commit.parent_count() > 0 {
            let parent = commit.parent(0)?;
            let parent_tree = parent.tree()?;
            let commit_tree = commit.tree()?;
            repo.diff_tree_to_tree(
                Some(&parent_tree),
                Some(&commit_tree),
                Some(&mut DiffOptions::new()),
            )?
        } else {
            let commit_tree = commit.tree()?;
            repo.diff_tree_to_tree(None, Some(&commit_tree), Some(&mut DiffOptions::new()))?
        };

        let diffs = Self::parse_diff(&diff)?;

        Ok(CommitDetail { info, diffs })
    }

    pub fn get_file_diff(path: &str, file_path: &str, staged: bool) -> GitResult<FileDiff> {
        let repo = Self::open(path)?;
        let mut diff_opts = DiffOptions::new();
        diff_opts.pathspec(file_path);

        let diff = if staged {
            let head_tree = repo
                .head()
                .ok()
                .and_then(|h| h.peel_to_commit().ok())
                .and_then(|c| c.tree().ok());
            let index = repo.index()?;
            repo.diff_tree_to_index(head_tree.as_ref(), Some(&index), Some(&mut diff_opts))?
        } else {
            // Include untracked file content so newly-added (untracked) files
            // show a proper line-by-line diff instead of an empty result.
            diff_opts
                .include_untracked(true)
                .show_untracked_content(true)
                .recurse_untracked_dirs(true);
            let index = repo.index()?;
            repo.diff_index_to_workdir(Some(&index), Some(&mut diff_opts))?
        };

        let diffs = Self::parse_diff(&diff)?;
        Ok(diffs
            .into_iter()
            .next()
            .unwrap_or(FileDiff {
                old_path: None,
                new_path: Some(file_path.to_string()),
                is_binary: false,
                hunks: vec![],
                additions: 0,
                deletions: 0,
            }))
    }

    fn parse_diff(diff: &git2::Diff) -> GitResult<Vec<FileDiff>> {
        let mut file_diffs: Vec<FileDiff> = Vec::new();
        let mut current_hunks: Vec<DiffHunk> = Vec::new();
        let mut current_file: Option<FileDiff> = None;
        let mut current_hunk: Option<DiffHunk> = None;
        let mut additions = 0usize;
        let mut deletions = 0usize;

        diff.print(DiffFormat::Patch, |delta, hunk, line| {
            use git2::Delta;
            use git2::DiffLineType;

            match line.origin_value() {
                DiffLineType::FileHeader => {
                    if let Some(mut f) = current_file.take() {
                        if let Some(h) = current_hunk.take() {
                            current_hunks.push(h);
                        }
                        f.hunks = current_hunks.drain(..).collect();
                        f.additions = additions;
                        f.deletions = deletions;
                        file_diffs.push(f);
                        additions = 0;
                        deletions = 0;
                    }
                    let old_path = delta.old_file().path().map(|p| p.to_string_lossy().to_string());
                    let new_path = delta.new_file().path().map(|p| p.to_string_lossy().to_string());
                    let is_binary = delta.old_file().is_binary() || delta.new_file().is_binary();
                    let status = match delta.status() {
                        Delta::Added => FileStatusKind::Added,
                        Delta::Deleted => FileStatusKind::Deleted,
                        Delta::Renamed => FileStatusKind::Renamed,
                        _ => FileStatusKind::Modified,
                    };
                    let _ = status;
                    current_file = Some(FileDiff {
                        old_path,
                        new_path,
                        is_binary,
                        hunks: vec![],
                        additions: 0,
                        deletions: 0,
                    });
                }
                DiffLineType::HunkHeader => {
                    if let Some(h) = current_hunk.take() {
                        current_hunks.push(h);
                    }
                    if let Some(hunk) = hunk {
                        current_hunk = Some(DiffHunk {
                            old_start: hunk.old_start(),
                            old_lines: hunk.old_lines(),
                            new_start: hunk.new_start(),
                            new_lines: hunk.new_lines(),
                            header: String::from_utf8_lossy(hunk.header()).to_string(),
                            lines: vec![],
                        });
                    }
                }
                DiffLineType::Addition => {
                    additions += 1;
                    if let Some(h) = current_hunk.as_mut() {
                        h.lines.push(DiffLine {
                            origin: '+',
                            content: String::from_utf8_lossy(line.content()).to_string(),
                            old_lineno: line.old_lineno(),
                            new_lineno: line.new_lineno(),
                        });
                    }
                }
                DiffLineType::Deletion => {
                    deletions += 1;
                    if let Some(h) = current_hunk.as_mut() {
                        h.lines.push(DiffLine {
                            origin: '-',
                            content: String::from_utf8_lossy(line.content()).to_string(),
                            old_lineno: line.old_lineno(),
                            new_lineno: line.new_lineno(),
                        });
                    }
                }
                DiffLineType::Context => {
                    if let Some(h) = current_hunk.as_mut() {
                        h.lines.push(DiffLine {
                            origin: ' ',
                            content: String::from_utf8_lossy(line.content()).to_string(),
                            old_lineno: line.old_lineno(),
                            new_lineno: line.new_lineno(),
                        });
                    }
                }
                _ => {}
            }
            true
        })?;

        // Flush last file
        if let Some(mut f) = current_file.take() {
            if let Some(h) = current_hunk.take() {
                current_hunks.push(h);
            }
            f.hunks = current_hunks.drain(..).collect();
            f.additions = additions;
            f.deletions = deletions;
            file_diffs.push(f);
        }

        Ok(file_diffs)
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
            let name = branch.name()?.unwrap_or("").to_string();
            let is_remote = branch_type == BranchType::Remote;
            let is_head = !is_remote && head_name.as_deref() == Some(name.as_str());

            // 对本地分支尝试获取上游分支信息
            let upstream_branch = if !is_remote { branch.upstream().ok() } else { None };
            let upstream = upstream_branch
                .as_ref()
                .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()));

            let local_oid = branch.get().peel_to_commit().ok().map(|c| c.id());
            let commit_oid = local_oid.map(|o| o.to_string());

            // 计算 ahead/behind（仅本地 && 有上游）
            let (ahead, behind) = if let (Some(local), Some(up)) =
                (local_oid, upstream_branch.as_ref())
            {
                match up.get().peel_to_commit() {
                    Ok(upstream_commit) => match repo.graph_ahead_behind(local, upstream_commit.id())
                    {
                        Ok((a, b)) => (Some(a as u32), Some(b as u32)),
                        Err(_) => (None, None),
                    },
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
            .map_err(|e| GitError::OperationFailed(format!("找不到远端分支 {}: {}", remote_branch, e.message())))?;
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

    pub fn switch_branch(path: &str, name: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let obj = repo
            .revparse_single(&format!("refs/heads/{}", name))
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        repo.checkout_tree(&obj, None)?;
        repo.set_head(&format!("refs/heads/{}", name))?;
        Ok(())
    }

    pub fn delete_branch(path: &str, name: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let mut branch = repo.find_branch(name, BranchType::Local)?;
        branch.delete()?;
        Ok(())
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
        repo.commit(
            Some("HEAD"),
            &commit.author(),
            &signature,
            commit.message().unwrap_or(""),
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
        let msg = format!(
            "Revert \"{}\"\n\nThis reverts commit {}.",
            commit.summary().unwrap_or(""),
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
    pub fn create_tag(
        path: &str,
        name: &str,
        oid: &str,
        message: Option<&str>,
    ) -> GitResult<()> {
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
        let repo = Self::open(path)?;
        let mut remote = repo.find_remote(remote_name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|url, username, allowed| {
            credential_callback(url, username, allowed)
        });
        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        remote.fetch(&[] as &[&str], Some(&mut fetch_opts), None)?;
        Ok(())
    }

    pub fn push(path: &str, remote_name: &str, branch_name: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let mut remote = repo.find_remote(remote_name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|url, username, allowed| {
            credential_callback(url, username, allowed)
        });
        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);
        let refspec = format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name);
        remote.push(&[&refspec], Some(&mut push_opts))?;
        Ok(())
    }

    pub fn pull(path: &str, remote_name: &str, branch_name: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let mut remote = repo.find_remote(remote_name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|url, username, allowed| {
            credential_callback(url, username, allowed)
        });
        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        remote.fetch(&[branch_name], Some(&mut fetch_opts), None)?;

        // Fast-forward merge
        let fetch_head = repo.find_reference("FETCH_HEAD")?;
        let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)?;
        let (merge_analysis, _) = repo.merge_analysis(&[&fetch_commit])?;

        if merge_analysis.is_fast_forward() {
            let refname = format!("refs/heads/{}", branch_name);
            let mut reference = repo.find_reference(&refname)?;
            reference.set_target(fetch_commit.id(), "Fast-forward")?;
            repo.set_head(&refname)?;
            repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
        } else if merge_analysis.is_normal() {
            return Err(GitError::OperationFailed(
                "Merge required - not yet supported in this version".to_string(),
            ));
        }

        Ok(())
    }

    pub fn list_remotes(path: &str) -> GitResult<Vec<String>> {
        let repo = Self::open(path)?;
        let remotes = repo.remotes()?;
        Ok(remotes.iter().flatten().map(|s| s.to_string()).collect())
    }

    #[allow(dead_code)]
    pub fn get_repo_state(path: &str) -> GitResult<String> {
        let repo = Self::open(path)?;
        let state = match repo.state() {
            RepositoryState::Clean => "clean",
            RepositoryState::Merge => "merge",
            RepositoryState::Revert | RepositoryState::RevertSequence => "revert",
            RepositoryState::CherryPick | RepositoryState::CherryPickSequence => "cherry-pick",
            RepositoryState::Bisect => "bisect",
            RepositoryState::Rebase
            | RepositoryState::RebaseInteractive
            | RepositoryState::RebaseMerge => "rebase",
            RepositoryState::ApplyMailbox | RepositoryState::ApplyMailboxOrRebase => {
                "apply-mailbox"
            }
        };
        Ok(state.to_string())
    }

    // ── Submodule 操作 ──────────────────────────────────────────────────

    /// 列出仓库内所有 submodule 以及各自的状态
    pub fn list_submodules(path: &str) -> GitResult<Vec<SubmoduleInfo>> {
        let repo = Self::open(path)?;
        let mut result = Vec::new();

        for sub in repo.submodules()? {
            let name = sub.name().unwrap_or("").to_string();
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
        let repo = Self::open(path)?;
        let mut sub = repo.find_submodule(name)?;

        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|url, username, allowed| {
            credential_callback(url, username, allowed)
        });
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

        // 1. 删除 .git/modules/<name>
        let modules_dir = repo.path().join("modules").join(name);
        if modules_dir.exists() {
            std::fs::remove_dir_all(&modules_dir).map_err(|e| {
                GitError::OperationFailed(format!(
                    "删除 {} 失败：{}",
                    modules_dir.display(),
                    e
                ))
            })?;
        }

        // 2. 删除工作区目录
        let workdir_path = repo_workdir.join(&sub_rel_path);
        if workdir_path.exists() {
            std::fs::remove_dir_all(&workdir_path).map_err(|e| {
                GitError::OperationFailed(format!(
                    "删除 {} 失败：{}",
                    workdir_path.display(),
                    e
                ))
            })?;
        }

        // 3. 重写 .gitmodules，剥离对应 section
        let gitmodules_path = repo_workdir.join(".gitmodules");
        let gitmodules_still_exists = gitmodules_path.exists();
        if gitmodules_still_exists {
            Self::strip_gitmodules_section(&gitmodules_path, name)?;
        }

        // 4. 从 .git/config 删除 submodule.<name>.* 条目
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

        // 5. 更新 index：移除 submodule 条目，重新 add .gitmodules
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

    // ── Stash ──────────────────────────────────────────────────────────

    /// Stash 当前工作区（包含未暂存的变更和 untracked 文件）
    pub fn stash_push(path: &str, message: Option<&str>) -> GitResult<()> {
        let mut repo = Self::open(path)?;
        let sig = repo.signature()?;
        let flags = StashFlags::INCLUDE_UNTRACKED;
        repo.stash_save2(&sig, message, Some(flags))?;
        Ok(())
    }

    /// Pop 最新的 stash（index 0）
    pub fn stash_pop(path: &str) -> GitResult<()> {
        let mut repo = Self::open(path)?;
        let mut has_any = false;
        repo.stash_foreach(|_, _, _| {
            has_any = true;
            false // 第一条就够了
        })?;
        if !has_any {
            return Err(GitError::OperationFailed("没有可 pop 的 stash".to_string()));
        }
        repo.stash_pop(0, None)?;
        Ok(())
    }

    /// 列出所有 stash 条目
    pub fn stash_list(path: &str) -> GitResult<Vec<StashEntry>> {
        let mut repo = Self::open(path)?;
        let mut out = Vec::new();
        repo.stash_foreach(|index, msg, oid| {
            out.push(StashEntry {
                index,
                message: msg.to_string(),
                commit_oid: oid.to_string(),
            });
            true
        })?;
        Ok(out)
    }

    // ── Amend ──────────────────────────────────────────────────────────

    /// 在当前 HEAD 上 amend 一次提交：用 index 里的 tree + 新 message 替换
    /// HEAD commit。返回新 commit OID。
    pub fn amend_commit(path: &str, message: &str) -> GitResult<String> {
        let repo = Self::open(path)?;
        if message.trim().is_empty() {
            return Err(GitError::OperationFailed(
                "提交信息不能为空".to_string(),
            ));
        }
        let head = repo.head()?.peel_to_commit()?;
        let sig = repo.signature()?;
        let mut index = repo.index()?;
        index.write()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let new_oid = head.amend(
            Some("HEAD"),
            Some(&sig),
            Some(&sig),
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

    /// 丢弃单个文件的工作区变更（恢复到 HEAD 版本）
    /// 若是 untracked 文件，会被移除。
    pub fn discard_file(path: &str, file_path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let mut cb = git2::build::CheckoutBuilder::new();
        cb.force().remove_untracked(true).path(file_path);
        repo.checkout_head(Some(&mut cb))?;
        Ok(())
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
            let message = entry.message().unwrap_or("").to_string();
            let committer = entry.committer();
            let committer_name = committer.name().unwrap_or("").to_string();
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
        let output = std::process::Command::new("git")
            .args(["-C", path, "gc", "--quiet"])
            .output()
            .map_err(|e| GitError::OperationFailed(format!("启动 git gc 失败：{}", e)))?;

        if output.status.success() {
            Ok("git gc 完成".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            Err(GitError::OperationFailed(format!(
                "git gc 失败：{}",
                stderr.trim()
            )))
        }
    }

    /// 从 .gitmodules 文本中移除 `[submodule "<name>"]` 及其后续字段行。
    /// 若删除后整个文件仅剩空白则删除文件本身。
    fn strip_gitmodules_section(gitmodules_path: &Path, name: &str) -> GitResult<()> {
        let content = std::fs::read_to_string(gitmodules_path).map_err(|e| {
            GitError::OperationFailed(format!("读取 .gitmodules 失败：{}", e))
        })?;

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
            std::fs::write(gitmodules_path, out).map_err(|e| {
                GitError::OperationFailed(format!("写入 .gitmodules 失败：{}", e))
            })?;
        } else {
            std::fs::remove_file(gitmodules_path).map_err(|e| {
                GitError::OperationFailed(format!("删除 .gitmodules 失败：{}", e))
            })?;
        }

        Ok(())
    }
}
