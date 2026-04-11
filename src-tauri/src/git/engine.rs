use git2::{
    BranchType, DiffFormat, DiffOptions, Repository, RepositoryState, ResetType,
    StatusOptions,
};

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

    pub fn get_log(path: &str, offset: usize, limit: usize) -> GitResult<LogPage> {
        let repo = Self::open(path)?;
        let mut revwalk = repo.revwalk()?;
        revwalk.push_head()?;
        revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;

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
            let parent_oids = commit
                .parent_ids()
                .map(|p| p.to_string())
                .collect();

            commits.push(CommitInfo {
                oid: oid.to_string(),
                short_oid: oid.to_string()[..7].to_string(),
                message: commit.message().unwrap_or("").to_string(),
                summary: commit.summary().unwrap_or("").to_string(),
                author_name: commit.author().name().unwrap_or("").to_string(),
                author_email: commit.author().email().unwrap_or("").to_string(),
                time: commit.time().seconds(),
                parent_oids,
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
            repo.diff_index_to_workdir(None, Some(&mut diff_opts))?
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
            let upstream = if !is_remote {
                branch
                    .upstream()
                    .ok()
                    .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()))
            } else {
                None
            };
            let commit_oid = branch
                .get()
                .peel_to_commit()
                .ok()
                .map(|c| c.id().to_string());

            branches.push(BranchInfo {
                name,
                is_remote,
                is_head,
                upstream,
                commit_oid,
            });
        }

        Ok(branches)
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
}
