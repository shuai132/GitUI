use git2::{Diff, DiffFormat, DiffOptions, Repository, RepositoryState, ResetType, StatusOptions};

use super::{commit_message_decoded, read_rebase_state, read_trimmed_file, GitEngine};
use crate::git::{error::GitResult, types::*};

impl GitEngine {
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
                let commit_message = commit.as_ref().map(commit_message_decoded);
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

        if !unstaged.is_empty() {
            let mut opts = DiffOptions::new();
            opts.include_untracked(false);
            if let Ok(index) = repo.index() {
                if let Ok(diff) = repo.diff_index_to_workdir(Some(&index), Some(&mut opts)) {
                    fill_stats(&mut unstaged, &diff);
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
}
