use base64::prelude::{Engine as _, BASE64_STANDARD};
use git2::{
    BranchType, Diff, DiffFormat, DiffOptions, Repository, RepositoryState, ResetType, StashFlags,
    StatusOptions, SubmoduleIgnore, SubmoduleStatus,
};
use std::path::{Path, PathBuf};

use crate::git::{
    credentials::make_credentials_callback,
    error::{GitError, GitResult},
    shellout::{get_remote_url, is_ssh_url, run_git},
    types::*,
};

/// 二进制预览（图片等）最大读取字节数，超过则不返回原始字节。
pub const MAX_PREVIEW_BYTES: u64 = 10 * 1024 * 1024;

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
                    additions: 0,
                    deletions: 0,
                });
            } else if status.is_index_modified() {
                staged.push(FileEntry {
                    path: path_str.clone(),
                    old_path: None,
                    status: FileStatusKind::Modified,
                    staged: true,
                    additions: 0,
                    deletions: 0,
                });
            } else if status.is_index_deleted() {
                staged.push(FileEntry {
                    path: path_str.clone(),
                    old_path: None,
                    status: FileStatusKind::Deleted,
                    staged: true,
                    additions: 0,
                    deletions: 0,
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
                    additions: 0,
                    deletions: 0,
                });
            }

            // Unstaged changes (working tree)
            if status.is_wt_modified() {
                unstaged.push(FileEntry {
                    path: path_str.clone(),
                    old_path: None,
                    status: FileStatusKind::Modified,
                    staged: false,
                    additions: 0,
                    deletions: 0,
                });
            } else if status.is_wt_deleted() {
                unstaged.push(FileEntry {
                    path: path_str.clone(),
                    old_path: None,
                    status: FileStatusKind::Deleted,
                    staged: false,
                    additions: 0,
                    deletions: 0,
                });
            } else if status.is_wt_new() {
                untracked.push(FileEntry {
                    path: path_str.clone(),
                    old_path: None,
                    status: FileStatusKind::Untracked,
                    staged: false,
                    additions: 0,
                    deletions: 0,
                });
            } else if status.is_conflicted() {
                unstaged.push(FileEntry {
                    path: path_str.clone(),
                    old_path: None,
                    status: FileStatusKind::Conflicted,
                    staged: false,
                    additions: 0,
                    deletions: 0,
                });
            }
        }

        // Get HEAD info
        let (head_branch, head_commit, head_commit_message, is_detached) = match repo.head() {
            Ok(head) => {
                let commit = head.peel_to_commit().ok();
                let commit_oid = commit.as_ref().map(|c| c.id().to_string());
                let commit_message = commit
                    .as_ref()
                    .and_then(|c| c.message().map(|m| m.to_string()));
                if head.is_branch() {
                    let branch_name = head.shorthand().map(|s| s.to_string());
                    (branch_name, commit_oid, commit_message, false)
                } else {
                    (None, commit_oid, commit_message, true)
                }
            }
            Err(_) => (None, None, None, false),
        };

        // Fill additions/deletions via batch diff stats
        let fill_stats = |entries: &mut Vec<FileEntry>, diff: &Diff| {
            let mut path_stats: std::collections::HashMap<String, (usize, usize)> =
                std::collections::HashMap::new();
            let mut additions = 0usize;
            let mut deletions = 0usize;
            let mut cur_path: Option<String> = None;

            let _ = diff.print(DiffFormat::Patch, |delta, _hunk, line| {
                use git2::DiffLineType;
                match line.origin_value() {
                    DiffLineType::FileHeader => {
                        if let Some(p) = cur_path.take() {
                            path_stats.insert(p, (additions, deletions));
                            additions = 0;
                            deletions = 0;
                        }
                        cur_path = delta
                            .new_file()
                            .path()
                            .or_else(|| delta.old_file().path())
                            .map(|p| p.to_string_lossy().to_string());
                    }
                    DiffLineType::Addition => additions += 1,
                    DiffLineType::Deletion => deletions += 1,
                    _ => {}
                }
                true
            });
            if let Some(p) = cur_path.take() {
                path_stats.insert(p, (additions, deletions));
            }

            for entry in entries.iter_mut() {
                if let Some((a, d)) = path_stats.get(&entry.path) {
                    entry.additions = *a;
                    entry.deletions = *d;
                }
            }
        };

        if !staged.is_empty() {
            let head_tree = repo
                .head()
                .ok()
                .and_then(|h| h.peel_to_commit().ok())
                .and_then(|c| c.tree().ok());
            if let Ok(index) = repo.index() {
                if let Ok(diff) = repo.diff_tree_to_index(head_tree.as_ref(), Some(&index), None) {
                    fill_stats(&mut staged, &diff);
                }
            }
        }

        if !unstaged.is_empty() || !untracked.is_empty() {
            let mut opts = DiffOptions::new();
            opts.include_untracked(true)
                .show_untracked_content(true)
                .recurse_untracked_dirs(true);
            if let Ok(index) = repo.index() {
                if let Ok(diff) = repo.diff_index_to_workdir(Some(&index), Some(&mut opts)) {
                    fill_stats(&mut unstaged, &diff);
                    fill_stats(&mut untracked, &diff);
                }
            }
        }

        let repo_state = Self::build_repo_state(&repo);

        Ok(WorkspaceStatus {
            staged,
            unstaged,
            untracked,
            head_branch,
            head_commit,
            head_commit_message,
            is_detached,
            repo_state,
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

        let commit_oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)?;

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

        let repo = Self::open(path)?;

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

        // ── Step B: 收集所有 stash 的 oid 集合，以及 stash 的辅助 parent
        // （index / untracked 快照 commit），这些在用户视角里不该作为独立行出现。
        let mut stash_set: HashSet<git2::Oid> = HashSet::new();
        if let Ok(entries) = Self::list_stashes(&repo) {
            for (_, _, oid) in entries {
                stash_set.insert(oid);
            }
        }

        // stash commit 是 3-parent 的特殊对象：
        //   parent[0] = HEAD（基准提交）
        //   parent[1] = "index on <branch>" 快照
        //   parent[2] = "untracked files on <branch>" 快照（INCLUDE_UNTRACKED 时）
        // 后两者只是 git 存储细节，收集进 stash_aux_set 以便稍后过滤。
        let mut stash_aux_set: HashSet<git2::Oid> = HashSet::new();
        for stash_oid in stash_set.iter().copied().collect::<Vec<_>>() {
            if let Ok(commit) = repo.find_commit(stash_oid) {
                for (i, parent) in commit.parent_ids().enumerate() {
                    if i > 0 {
                        stash_aux_set.insert(parent);
                    }
                }
            }
        }

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

        // 收集"被 push 为 revwalk 起点"的 reflog oid（只记 unreachable 分支下的那些），
        // 以及"严格是其他 reflog oid 祖先"的集合——用于下面计算 is_reflog_tip。
        let mut reflog_oids: HashSet<git2::Oid> = HashSet::new();
        let mut strict_ancestors: HashSet<git2::Oid> = HashSet::new();

        if include_unreachable {
            // 遍历 HEAD reflog，把不在 reachable 也不在 stash 集合里的 oid 推入
            if let Ok(reflog) = repo.reflog("HEAD") {
                for entry in reflog.iter() {
                    let oid = entry.id_new();
                    if !reachable.contains(&oid) && !stash_set.contains(&oid) {
                        revwalk.push(oid).ok();
                        reflog_oids.insert(oid);
                    }
                }
            }

            // Tip 判定：对每个 reflog_oid 单独 walk 一次，跳过自身后的遍历结果
            // 就是它的严格祖先。一个 reflog_oid 如果出现在别人的严格祖先里，就不是 tip。
            // reflog 条目上限 500，实测代价可忽略。
            for root in &reflog_oids {
                if let Ok(mut aux) = repo.revwalk() {
                    if aux.push(*root).is_err() {
                        continue;
                    }
                    // 第一个元素是 root 本身，跳过；其余即为严格祖先
                    let mut it = aux.into_iter();
                    let _ = it.next();
                    for oid_result in it {
                        if let Ok(anc) = oid_result {
                            strict_ancestors.insert(anc);
                        }
                    }
                }
            }
        }

        let mut commits = Vec::new();
        let mut idx = 0;
        let mut has_more = false;

        for oid_result in revwalk {
            let oid = oid_result?;
            // 跳过 stash 的辅助 commit（index / untracked 快照），它们不作为独立行
            if stash_aux_set.contains(&oid) {
                continue;
            }
            if idx < offset {
                idx += 1;
                continue;
            }
            if commits.len() >= limit {
                has_more = true;
                break;
            }
            let commit = repo.find_commit(oid)?;
            let is_stash = stash_set.contains(&oid);
            let is_unreachable = !is_stash && !reachable.contains(&oid);
            let is_reflog_tip =
                is_unreachable && reflog_oids.contains(&oid) && !strict_ancestors.contains(&oid);

            // stash 在 DAG 中视作普通 1-parent commit：parent_oids 只保留 parent[0] (HEAD)
            let parent_oids: Vec<String> = if is_stash {
                commit
                    .parent_ids()
                    .next()
                    .map(|p| vec![p.to_string()])
                    .unwrap_or_default()
            } else {
                commit.parent_ids().map(|p| p.to_string()).collect()
            };

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
                is_reflog_tip,
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
            is_reflog_tip: false,
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

        // 冲突文件：index 只有 stage 1/2/3，没有 stage 0，
        // 走 diff_index_to_workdir 会被跳过导致返回空。改用 stage 2 blob 与工作区手动 diff。
        if !staged {
            if let Some(diff) = Self::try_conflict_diff(&repo, file_path)? {
                return Ok(diff);
            }
        }

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
        Ok(diffs.into_iter().next().unwrap_or(FileDiff {
            old_path: None,
            new_path: Some(file_path.to_string()),
            is_binary: false,
            hunks: vec![],
            additions: 0,
            deletions: 0,
            old_blob_oid: None,
            new_blob_oid: None,
        }))
    }

    /// 如果 `file_path` 是冲突文件，用 stage 2（ours）blob 与工作区内容做 diff。
    /// 非冲突返回 Ok(None)，让调用方继续走原路径。
    fn try_conflict_diff(
        repo: &Repository,
        file_path: &str,
    ) -> GitResult<Option<FileDiff>> {
        let index = repo.index()?;
        let conflict = match index.conflicts() {
            Ok(iter) => {
                let mut found = None;
                for c in iter {
                    let c = c?;
                    let p = c
                        .ancestor
                        .as_ref()
                        .or(c.our.as_ref())
                        .or(c.their.as_ref())
                        .and_then(|e| std::str::from_utf8(&e.path).ok());
                    if p == Some(file_path) {
                        found = Some(c);
                        break;
                    }
                }
                found
            }
            Err(_) => None,
        };
        let conflict = match conflict {
            Some(c) => c,
            None => return Ok(None),
        };

        // "old" = ours（stage 2）、"new" = 工作区当前内容（含冲突标记）
        let ours_blob = conflict
            .our
            .as_ref()
            .and_then(|e| repo.find_blob(e.id).ok());
        let old_bytes: Vec<u8> = ours_blob
            .as_ref()
            .map(|b| b.content().to_vec())
            .unwrap_or_default();
        let old_blob_oid = conflict.our.as_ref().map(|e| e.id.to_string());

        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::OperationFailed("裸仓库不支持".to_string()))?;
        let new_bytes = std::fs::read(workdir.join(file_path)).unwrap_or_default();

        let is_binary = old_bytes.contains(&0) || new_bytes.contains(&0);

        let mut hunks: Vec<DiffHunk> = Vec::new();
        let mut additions = 0usize;
        let mut deletions = 0usize;

        if !is_binary {
            let mut diff_opts = git2::DiffOptions::new();
            diff_opts.context_lines(3).interhunk_lines(0);
            let patch = git2::Patch::from_buffers(
                &old_bytes,
                Some(std::path::Path::new(file_path)),
                &new_bytes,
                Some(std::path::Path::new(file_path)),
                Some(&mut diff_opts),
            )?;
            let num_hunks = patch.num_hunks();
            for hi in 0..num_hunks {
                let (hunk, num_lines) = patch.hunk(hi)?;
                let mut cur = DiffHunk {
                    old_start: hunk.old_start(),
                    old_lines: hunk.old_lines(),
                    new_start: hunk.new_start(),
                    new_lines: hunk.new_lines(),
                    header: String::from_utf8_lossy(hunk.header()).to_string(),
                    lines: vec![],
                };
                for li in 0..num_lines {
                    let line = patch.line_in_hunk(hi, li)?;
                    let origin = line.origin();
                    match origin {
                        '+' => additions += 1,
                        '-' => deletions += 1,
                        _ => {}
                    }
                    cur.lines.push(DiffLine {
                        origin,
                        content: String::from_utf8_lossy(line.content()).to_string(),
                        old_lineno: line.old_lineno(),
                        new_lineno: line.new_lineno(),
                    });
                }
                hunks.push(cur);
            }
        }

        Ok(Some(FileDiff {
            old_path: Some(file_path.to_string()),
            new_path: Some(file_path.to_string()),
            is_binary,
            hunks,
            additions,
            deletions,
            old_blob_oid,
            new_blob_oid: None,
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
                    let old_path = delta
                        .old_file()
                        .path()
                        .map(|p| p.to_string_lossy().to_string());
                    let new_path = delta
                        .new_file()
                        .path()
                        .map(|p| p.to_string_lossy().to_string());
                    let is_binary = delta.old_file().is_binary() || delta.new_file().is_binary();
                    let status = match delta.status() {
                        Delta::Added => FileStatusKind::Added,
                        Delta::Deleted => FileStatusKind::Deleted,
                        Delta::Renamed => FileStatusKind::Renamed,
                        _ => FileStatusKind::Modified,
                    };
                    let _ = status;
                    let old_id = delta.old_file().id();
                    let new_id = delta.new_file().id();
                    let old_blob_oid = if old_id.is_zero() {
                        None
                    } else {
                        Some(old_id.to_string())
                    };
                    let new_blob_oid = if new_id.is_zero() {
                        None
                    } else {
                        Some(new_id.to_string())
                    };
                    current_file = Some(FileDiff {
                        old_path,
                        new_path,
                        is_binary,
                        hunks: vec![],
                        additions: 0,
                        deletions: 0,
                        old_blob_oid,
                        new_blob_oid,
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

    /// 按 blob oid 读取原始字节并 base64 编码（用于二进制文件预览）。
    /// 超过 `MAX_PREVIEW_BYTES` 时返回 `truncated=true`，不带字节。
    pub fn get_blob_bytes(path: &str, oid_str: &str) -> GitResult<BlobData> {
        let repo = Self::open(path)?;
        let oid = git2::Oid::from_str(oid_str)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let blob = repo.find_blob(oid)?;
        let size = blob.size() as u64;
        if size > MAX_PREVIEW_BYTES {
            return Ok(BlobData {
                bytes_base64: String::new(),
                size,
                truncated: true,
            });
        }
        let encoded = BASE64_STANDARD.encode(blob.content());
        Ok(BlobData {
            bytes_base64: encoded,
            size,
            truncated: false,
        })
    }

    /// 读取工作区内相对路径的文件字节（用于预览 WIP 未暂存的新版）。
    /// 路径会规范化后校验仍位于仓库目录内，防止路径穿越。
    pub fn read_worktree_file(path: &str, rel_path: &str) -> GitResult<BlobData> {
        let repo_root = Path::new(path)
            .canonicalize()
            .map_err(|e| GitError::OperationFailed(format!("canonicalize repo: {}", e)))?;
        let full = repo_root.join(rel_path);
        let full_canon = full
            .canonicalize()
            .map_err(|e| GitError::OperationFailed(format!("file not found: {}", e)))?;
        if !full_canon.starts_with(&repo_root) {
            return Err(GitError::OperationFailed(
                "path escapes repository root".to_string(),
            ));
        }
        let meta = std::fs::metadata(&full_canon)
            .map_err(|e| GitError::OperationFailed(format!("stat file: {}", e)))?;
        let size = meta.len();
        if size > MAX_PREVIEW_BYTES {
            return Ok(BlobData {
                bytes_base64: String::new(),
                size,
                truncated: true,
            });
        }
        let bytes = std::fs::read(&full_canon)
            .map_err(|e| GitError::OperationFailed(format!("read file: {}", e)))?;
        Ok(BlobData {
            bytes_base64: BASE64_STANDARD.encode(&bytes),
            size,
            truncated: false,
        })
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
                .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()));

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
            let Ok(name_str) = std::str::from_utf8(name_bytes) else {
                return true;
            };
            let short = name_str
                .strip_prefix("refs/tags/")
                .unwrap_or(name_str)
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
                tags.push(TagInfo {
                    name: short,
                    commit_oid,
                    is_annotated: true,
                    message: tag_obj.message().map(|s| s.trim().to_string()),
                    tagger_name: tagger
                        .as_ref()
                        .and_then(|t| t.name().map(|s| s.to_string())),
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

    /// 列出远端所有 tag 的短名（通过 `ls-remote`，不做 fetch）。
    /// Git 的 tag 是共享命名空间，本地没有 `refs/remotes/<remote>/tags/*` 镜像，
    /// 所以只能在线查询远端 refs 才能判断某个本地 tag 是否已推送。
    pub fn list_remote_tag_names(path: &str, remote_name: &str) -> GitResult<Vec<String>> {
        log::debug!("[engine::list_remote_tag_names] remote={remote_name}");

        let url = get_remote_url(path, remote_name)?;
        if is_ssh_url(&url) {
            // `git ls-remote --tags <remote>` 输出格式：`<oid>\trefs/tags/<name>[^{}]`
            let stdout = run_git(path, &["ls-remote", "--tags", remote_name])?;
            let mut names = Vec::new();
            for line in stdout.lines() {
                if let Some((_oid, refname)) = line.split_once('\t') {
                    if refname.starts_with("refs/tags/") && !refname.ends_with("^{}") {
                        names.push(refname["refs/tags/".len()..].to_string());
                    }
                }
            }
            log::debug!(
                "[engine::list_remote_tag_names] remote={remote_name} count={} (ssh cli)",
                names.len()
            );
            return Ok(names);
        }

        let repo = Self::open(path)?;
        let mut remote = repo.find_remote(remote_name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());
        remote.connect_auth(git2::Direction::Fetch, Some(callbacks), None)?;
        let heads = remote.list()?;

        let mut names: Vec<String> = Vec::new();
        for head in heads {
            let name = head.name();
            // annotated tag 会额外多出一条 `refs/tags/X^{}`（peeled），短名与原 tag
            // 重复，直接跳过。
            if !name.starts_with("refs/tags/") || name.ends_with("^{}") {
                continue;
            }
            names.push(name["refs/tags/".len()..].to_string());
        }
        // 断开连接，避免占用（RemoteCallbacks 里的借用到此释放）
        let _ = remote.disconnect();
        log::debug!(
            "[engine::list_remote_tag_names] remote={remote_name} count={}",
            names.len()
        );
        Ok(names)
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
    pub fn push_tag(path: &str, remote_name: &str, tag_name: &str) -> GitResult<()> {
        log::debug!("[engine::push_tag] remote={remote_name} tag={tag_name}");
        let refspec = format!("refs/tags/{name}:refs/tags/{name}", name = tag_name);

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
            // mode == "ff": default behavior
            return Err(GitError::OperationFailed(
                "Merge required - not yet supported in this version".to_string(),
            ));
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

    // ── Clone / Init ────────────────────────────────────────────────────

    /// 克隆远程仓库到 `target_path`。
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
            return Self::clone_repo_ssh(
                url,
                target_path,
                depth,
                recurse_submodules,
                on_progress,
            );
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
                .filter_map(|s| s.name().map(|n| n.to_string()))
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

        let mut child = Command::new("git")
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
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

    pub fn list_remotes(path: &str) -> GitResult<Vec<String>> {
        let repo = Self::open(path)?;
        let remotes = repo.remotes()?;
        Ok(remotes.iter().flatten().map(|s| s.to_string()).collect())
    }

    pub fn get_repo_state(path: &str) -> GitResult<RepoState> {
        let repo = Self::open(path)?;
        Ok(Self::build_repo_state(&repo))
    }

    /// 读取仓库当前状态（含 merge/rebase 的中间态元数据）。
    /// 失败场景（读文件报错、路径不存在）统一降级为 Clean，避免阻断 `get_status` 主流程。
    fn build_repo_state(repo: &Repository) -> RepoState {
        let head_oid = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .map(|c| c.id().to_string());

        let kind = match repo.state() {
            RepositoryState::Clean => RepoStateKind::Clean,
            RepositoryState::Merge => RepoStateKind::Merge,
            RepositoryState::Revert | RepositoryState::RevertSequence => RepoStateKind::Revert,
            RepositoryState::CherryPick | RepositoryState::CherryPickSequence => {
                RepoStateKind::CherryPick
            }
            RepositoryState::Bisect => RepoStateKind::Bisect,
            RepositoryState::Rebase => RepoStateKind::Rebase,
            RepositoryState::RebaseInteractive => RepoStateKind::RebaseInteractive,
            RepositoryState::RebaseMerge => RepoStateKind::RebaseMerge,
            RepositoryState::ApplyMailbox | RepositoryState::ApplyMailboxOrRebase => {
                RepoStateKind::ApplyMailbox
            }
        };

        let git_dir = repo.path().to_path_buf();

        let mut merge_msg = None;
        let mut merge_head = None;
        if matches!(kind, RepoStateKind::Merge) {
            merge_msg = read_trimmed_file(&git_dir.join("MERGE_MSG"));
            merge_head = read_trimmed_file(&git_dir.join("MERGE_HEAD"))
                .and_then(|s| s.lines().next().map(|l| l.trim().to_string()));
        }

        let (
            rebase_onto,
            rebase_orig_head,
            rebase_head_name,
            rebase_step,
            rebase_total,
            rebase_current_oid,
        ) = if matches!(
            kind,
            RepoStateKind::Rebase | RepoStateKind::RebaseInteractive | RepoStateKind::RebaseMerge
        ) {
            read_rebase_state(&git_dir)
        } else {
            (None, None, None, None, None, None)
        };

        RepoState {
            kind,
            head_oid,
            merge_msg,
            merge_head,
            rebase_onto,
            rebase_orig_head,
            rebase_head_name,
            rebase_step,
            rebase_total,
            rebase_current_oid,
        }
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
                GitError::OperationFailed(format!("删除 {} 失败：{}", modules_dir.display(), e))
            })?;
        }

        // 2. 删除工作区目录
        let workdir_path = repo_workdir.join(&sub_rel_path);
        if workdir_path.exists() {
            std::fs::remove_dir_all(&workdir_path).map_err(|e| {
                GitError::OperationFailed(format!("删除 {} 失败：{}", workdir_path.display(), e))
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
                .map(|b| String::from_utf8_lossy(b).into_owned())
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

    // ── Amend ──────────────────────────────────────────────────────────

    /// 在当前 HEAD 上 amend 一次提交：用 index 里的 tree + 新 message 替换
    /// HEAD commit。返回新 commit OID。
    pub fn amend_commit(path: &str, message: &str) -> GitResult<String> {
        let repo = Self::open(path)?;
        if message.trim().is_empty() {
            return Err(GitError::OperationFailed("提交信息不能为空".to_string()));
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

    /// 仅修改 HEAD commit 的 message，不改变 tree（不引入新的暂存变更）。
    /// 返回新 commit OID。
    pub fn amend_commit_message(path: &str, message: &str) -> GitResult<String> {
        let repo = Self::open(path)?;
        if message.trim().is_empty() {
            return Err(GitError::OperationFailed("提交信息不能为空".to_string()));
        }
        let head = repo.head()?.peel_to_commit()?;
        let sig = repo.signature()?;
        let tree = head.tree()?;
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
            let Ok(mut walk) = repo.revwalk() else { continue };
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

    /// 从 .gitmodules 文本中移除 `[submodule "<name>"]` 及其后续字段行。
    /// 若删除后整个文件仅剩空白则删除文件本身。
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

    /// 返回触碰过 `file_path` 的提交列表（从 HEAD 开始向前遍历）。
    /// 按 TOPOLOGICAL | TIME 排序，支持分页（offset + limit，limit 上限 200）。
    pub fn get_file_log(
        path: &str,
        file_path: &str,
        offset: usize,
        limit: usize,
    ) -> GitResult<Vec<CommitInfo>> {
        let repo = Self::open(path)?;
        let mut revwalk = repo.revwalk()?;
        revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;
        revwalk.push_head().map_err(|e| {
            GitError::OperationFailed(format!("no HEAD: {}", e.message()))
        })?;

        let mut results = Vec::new();
        let mut skipped = 0usize;

        'outer: for oid_result in revwalk {
            let oid = oid_result?;
            let commit = repo.find_commit(oid)?;

            // 检查该 commit 是否触碰了目标文件
            let touched = Self::commit_touches_file(&repo, &commit, file_path)?;
            if !touched {
                continue;
            }

            if skipped < offset {
                skipped += 1;
                continue;
            }
            if results.len() >= limit {
                break 'outer;
            }

            let parent_oids = commit.parent_ids().map(|p| p.to_string()).collect();
            results.push(CommitInfo {
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
                is_reflog_tip: false,
            });
        }

        Ok(results)
    }

    /// 判断一个 commit 是否修改了 file_path（对比第一个父提交，根提交对比空树）。
    fn commit_touches_file(
        repo: &git2::Repository,
        commit: &git2::Commit,
        file_path: &str,
    ) -> GitResult<bool> {
        let commit_tree = commit.tree()?;

        let mut diff_opts = DiffOptions::new();
        diff_opts.pathspec(file_path);

        let parent_tree = if commit.parent_count() > 0 {
            Some(commit.parent(0)?.tree()?)
        } else {
            None
        };

        let diff = repo.diff_tree_to_tree(
            parent_tree.as_ref(),
            Some(&commit_tree),
            Some(&mut diff_opts),
        )?;

        Ok(diff.deltas().count() > 0)
    }

    /// 返回指定提交里 file_path 的 diff（仅该文件，不加载整个 CommitDetail）。
    pub fn get_file_diff_at_commit(
        path: &str,
        file_path: &str,
        oid_str: &str,
    ) -> GitResult<FileDiff> {
        let repo = Self::open(path)?;
        let oid = git2::Oid::from_str(oid_str)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let commit = repo.find_commit(oid)?;
        let commit_tree = commit.tree()?;

        let mut diff_opts = DiffOptions::new();
        diff_opts.pathspec(file_path);

        let diff = if commit.parent_count() > 0 {
            let parent_tree = commit.parent(0)?.tree()?;
            repo.diff_tree_to_tree(
                Some(&parent_tree),
                Some(&commit_tree),
                Some(&mut diff_opts),
            )?
        } else {
            repo.diff_tree_to_tree(None, Some(&commit_tree), Some(&mut diff_opts))?
        };

        let diffs = Self::parse_diff(&diff)?;
        Ok(diffs.into_iter().next().unwrap_or(FileDiff {
            old_path: None,
            new_path: Some(file_path.to_string()),
            is_binary: false,
            hunks: vec![],
            additions: 0,
            deletions: 0,
            old_blob_oid: None,
            new_blob_oid: None,
        }))
    }

    /// 返回工作区文件的 blame 信息（基于 HEAD，不包含未提交行的内容）。
    pub fn get_file_blame(path: &str, file_path: &str) -> GitResult<FileBlame> {
        let repo = Self::open(path)?;

        // 读工作区文件内容作为 lines
        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::OperationFailed("bare repo not supported".to_string()))?;
        let full_path = workdir.join(file_path);
        let content = std::fs::read_to_string(&full_path).map_err(|e| {
            GitError::OperationFailed(format!("读取文件失败：{}", e))
        })?;
        let lines: Vec<String> = content.lines().map(String::from).collect();

        // 计算 blame
        let blame = repo
            .blame_file(Path::new(file_path), None)
            .map_err(|e| GitError::OperationFailed(format!("blame 失败：{}", e.message())))?;

        let mut hunks = Vec::new();
        for hunk in blame.iter() {
            let orig_oid = hunk.orig_commit_id();
            let (commit_oid_str, short_oid, author_name, author_email, time, summary) =
                if orig_oid.is_zero() {
                    (
                        "0000000000000000000000000000000000000000".to_string(),
                        "0000000".to_string(),
                        "Not Committed Yet".to_string(),
                        String::new(),
                        0i64,
                        "Not Committed Yet".to_string(),
                    )
                } else {
                    match repo.find_commit(orig_oid) {
                        Ok(c) => (
                            orig_oid.to_string(),
                            orig_oid.to_string()[..7].to_string(),
                            c.author().name().unwrap_or("").to_string(),
                            c.author().email().unwrap_or("").to_string(),
                            c.time().seconds(),
                            c.summary().unwrap_or("").to_string(),
                        ),
                        Err(_) => (
                            orig_oid.to_string(),
                            orig_oid.to_string()[..7].to_string(),
                            String::new(),
                            String::new(),
                            0i64,
                            String::new(),
                        ),
                    }
                };

            hunks.push(BlameHunk {
                start_line: hunk.final_start_line() as u32,
                num_lines: hunk.lines_in_hunk() as u32,
                commit_oid: commit_oid_str,
                short_oid,
                author_name,
                author_email,
                time,
                summary,
            });
        }

        Ok(FileBlame { lines, hunks })
    }

    /// 从指定提交签出单个文件到工作目录（不修改 HEAD 或暂存区）。
    /// 若该提交中不存在此文件，返回错误。
    pub fn checkout_file_at_commit(path: &str, sha: &str, file_path: &str) -> GitResult<()> {
        use std::path::Path;
        let repo = Self::open(path)?;
        let oid = git2::Oid::from_str(sha)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let commit = repo.find_commit(oid)?;
        let tree = commit.tree()?;
        let entry = tree
            .get_path(Path::new(file_path))
            .map_err(|_| {
                GitError::OperationFailed(format!("文件 {} 在该提交中不存在", file_path))
            })?;
        let blob = repo
            .find_blob(entry.id())
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::OperationFailed("裸仓库不支持签出文件".to_string()))?;
        let dest = workdir.join(file_path);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| GitError::OperationFailed(format!("创建目录失败：{}", e)))?;
        }
        std::fs::write(&dest, blob.content())
            .map_err(|e| GitError::OperationFailed(format!("写入文件失败：{}", e)))?;
        Ok(())
    }
}

fn read_trimmed_file(p: &Path) -> Option<String> {
    std::fs::read_to_string(p).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
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
    let orig_head = read_trimmed_file(&dir.join("orig-head"))
        .or_else(|| read_trimmed_file(&dir.join("head")));
    let head_name = read_trimmed_file(&dir.join("head-name"));
    let current_oid = read_trimmed_file(&dir.join("stopped-sha"));

    // rebase-apply: msgnum + end；rebase-merge: msgnum（1-based 已完成步）/ end，
    // 或 done 文件行数 + git-rebase-todo 剩余行数（此处取 msgnum/end 足矣）
    let step = read_trimmed_file(&dir.join("msgnum")).and_then(|s| s.parse::<u32>().ok());
    let total = read_trimmed_file(&dir.join("end")).and_then(|s| s.parse::<u32>().ok());

    (onto, orig_head, head_name, step, total, current_oid)
}
