use std::path::{Path, PathBuf};

use git2::{BranchType, Repository, WorktreeAddOptions};

use crate::git::error::{GitError, GitResult};

use super::GitEngine;

impl GitEngine {
    /// 创建 linked worktree，并基于指定起点创建一个新的本地分支。
    ///
    /// 返回创建后的 worktree 根目录路径。调用方负责把该路径注册进 RepoManager。
    pub fn create_worktree(
        path: &str,
        target_path: &str,
        branch_name: &str,
        start_point: Option<&str>,
        start_point_is_remote: bool,
        expected_start_oid: &str,
    ) -> GitResult<String> {
        let repo = Self::open(path)?;
        repo.workdir()
            .ok_or_else(|| GitError::InvalidPath("Bare repos not supported".to_string()))?;

        let target = validate_worktree_target(target_path)?;
        let branch_name = validate_branch_name(branch_name)?;
        if repo.find_branch(branch_name, BranchType::Local).is_ok() {
            return Err(GitError::OperationFailed(format!(
                "branch already exists: {branch_name}"
            )));
        }

        let start_commit = resolve_start_commit(
            &repo,
            start_point,
            start_point_is_remote,
            expected_start_oid,
        )?;
        let created_branch = repo.branch(branch_name, &start_commit, false)?;
        drop(start_commit);

        let worktree_name = unique_worktree_name(&repo, &target)?;
        let worktree_result = {
            let reference = created_branch.into_reference();
            let mut opts = WorktreeAddOptions::new();
            opts.reference(Some(&reference));
            repo.worktree(&worktree_name, &target, Some(&opts))
        };

        let worktree = match worktree_result {
            Ok(worktree) => worktree,
            Err(e) => {
                if let Ok(mut branch) = repo.find_branch(branch_name, BranchType::Local) {
                    let _ = branch.delete();
                }
                return Err(GitError::OperationFailed(format!(
                    "failed to create worktree: {}",
                    e.message()
                )));
            }
        };

        let path = worktree.path();
        let abs = path
            .canonicalize()
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy()
            .to_string();
        Ok(abs)
    }
}

fn validate_worktree_target(raw: &str) -> GitResult<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(GitError::InvalidPath("worktree path is empty".to_string()));
    }

    let target = PathBuf::from(trimmed);
    let parent = target.parent().ok_or_else(|| {
        GitError::InvalidPath(format!("invalid worktree path: {}", target.display()))
    })?;
    if !parent.is_dir() {
        return Err(GitError::InvalidPath(format!(
            "parent directory not found: {}",
            parent.display()
        )));
    }

    if target.exists() {
        if !target.is_dir() {
            return Err(GitError::InvalidPath(format!(
                "target path is not a directory: {}",
                target.display()
            )));
        }
        if Repository::open(&target).is_ok() {
            return Err(GitError::OperationFailed(format!(
                "target directory is already a git repository: {}",
                target.display()
            )));
        }
        if !is_dir_empty(&target) {
            return Err(GitError::OperationFailed(format!(
                "target directory already exists and is not empty: {}",
                target.display()
            )));
        }
    }

    Ok(target)
}

fn validate_branch_name(raw: &str) -> GitResult<&str> {
    let branch_name = raw.trim();
    if branch_name.is_empty() {
        return Err(GitError::OperationFailed(
            "worktree branch name is empty".to_string(),
        ));
    }
    let valid = git2::Branch::name_is_valid(branch_name)
        .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
    if !valid {
        return Err(GitError::OperationFailed(format!(
            "invalid branch name: {branch_name}"
        )));
    }
    Ok(branch_name)
}

fn resolve_start_commit<'repo>(
    repo: &'repo Repository,
    start_point: Option<&str>,
    start_point_is_remote: bool,
    expected_start_oid: &str,
) -> GitResult<git2::Commit<'repo>> {
    let expected = git2::Oid::from_str(expected_start_oid).map_err(|e| {
        GitError::OperationFailed(format!("invalid expected worktree start OID: {e}"))
    })?;
    let commit = if let Some(name) = start_point.map(str::trim).filter(|s| !s.is_empty()) {
        let branch_type = if start_point_is_remote {
            BranchType::Remote
        } else {
            BranchType::Local
        };
        let branch = repo.find_branch(name, branch_type).map_err(|e| {
            let kind = if start_point_is_remote {
                "remote branch"
            } else {
                "local branch"
            };
            GitError::OperationFailed(format!("cannot find {kind} '{name}': {}", e.message()))
        })?;
        branch
            .get()
            .peel_to_commit()
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?
    } else {
        repo.head()?.peel_to_commit()?
    };
    if commit.id() != expected {
        return Err(GitError::OperationFailed(format!(
            "Worktree start point changed: expected {expected}, current {}",
            commit.id()
        )));
    }
    Ok(commit)
}

fn unique_worktree_name(repo: &Repository, target: &Path) -> GitResult<String> {
    let base = target
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            GitError::InvalidPath(format!(
                "worktree path has no directory name: {}",
                target.display()
            ))
        })?;

    for idx in 0..1000 {
        let candidate = if idx == 0 {
            base.to_string()
        } else {
            format!("{base}-{}", idx + 1)
        };
        if repo.find_worktree(&candidate).is_err() {
            return Ok(candidate);
        }
    }

    Err(GitError::OperationFailed(
        "cannot allocate a unique worktree name".to_string(),
    ))
}

fn is_dir_empty(path: &Path) -> bool {
    match std::fs::read_dir(path) {
        Ok(mut iter) => iter.next().is_none(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_utils::TestRepo;
    use std::fs;

    fn head_oid(repo: &Repository) -> git2::Oid {
        repo.head().unwrap().target().unwrap()
    }

    fn commit_file(
        test_repo: &TestRepo,
        message: &str,
        file_name: &str,
        content: &str,
    ) -> git2::Oid {
        fs::write(test_repo.dir.path().join(file_name), content).unwrap();
        let mut index = test_repo.repo.index().unwrap();
        index.add_path(Path::new(file_name)).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = test_repo.repo.find_tree(tree_oid).unwrap();
        let parent = test_repo.repo.head().unwrap().peel_to_commit().unwrap();
        let sig = test_repo.repo.signature().unwrap();
        test_repo
            .repo
            .commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])
            .unwrap()
    }

    #[test]
    fn creates_worktree_from_head() {
        let test_repo = TestRepo::new();
        let oid = head_oid(&test_repo.repo);
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("feature-head");

        let worktree_path = GitEngine::create_worktree(
            test_repo.path_str(),
            target.to_str().unwrap(),
            "feature/head",
            None,
            false,
            &oid.to_string(),
        )
        .unwrap();

        assert_eq!(Path::new(&worktree_path), target.canonicalize().unwrap());
        let worktree_repo = Repository::open(&worktree_path).unwrap();
        assert_eq!(
            worktree_repo.head().unwrap().shorthand(),
            Some("feature/head")
        );
        assert!(Path::new(&worktree_path).join("existing.txt").exists());
        assert!(test_repo
            .repo
            .find_branch("feature/head", BranchType::Local)
            .is_ok());
    }

    #[test]
    fn creates_worktree_from_local_branch() {
        let test_repo = TestRepo::new();
        let commit = test_repo
            .repo
            .find_commit(head_oid(&test_repo.repo))
            .unwrap();
        test_repo.repo.branch("base/local", &commit, false).unwrap();
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("feature-local");

        let worktree_path = GitEngine::create_worktree(
            test_repo.path_str(),
            target.to_str().unwrap(),
            "feature/local",
            Some("base/local"),
            false,
            &commit.id().to_string(),
        )
        .unwrap();

        let worktree_repo = Repository::open(&worktree_path).unwrap();
        assert_eq!(
            worktree_repo.head().unwrap().shorthand(),
            Some("feature/local")
        );
        let created = test_repo
            .repo
            .find_branch("feature/local", BranchType::Local)
            .unwrap();
        assert_eq!(created.get().target(), Some(commit.id()));
    }

    #[test]
    fn creates_worktree_from_remote_branch() {
        let test_repo = TestRepo::new();
        let oid = head_oid(&test_repo.repo);
        test_repo
            .repo
            .reference("refs/remotes/origin/main", oid, true, "test")
            .unwrap();
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("feature-remote");

        let worktree_path = GitEngine::create_worktree(
            test_repo.path_str(),
            target.to_str().unwrap(),
            "feature/remote",
            Some("origin/main"),
            true,
            &oid.to_string(),
        )
        .unwrap();

        let worktree_repo = Repository::open(&worktree_path).unwrap();
        assert_eq!(
            worktree_repo.head().unwrap().shorthand(),
            Some("feature/remote")
        );
        let created = test_repo
            .repo
            .find_branch("feature/remote", BranchType::Local)
            .unwrap();
        assert_eq!(created.get().target(), Some(oid));
    }

    #[test]
    fn rejects_existing_branch_and_non_empty_target() {
        let test_repo = TestRepo::new();
        let oid = head_oid(&test_repo.repo);
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("not-empty");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("file.txt"), "content\n").unwrap();

        let err = GitEngine::create_worktree(
            test_repo.path_str(),
            target.to_str().unwrap(),
            "feature/non-empty",
            None,
            false,
            &oid.to_string(),
        )
        .unwrap_err();
        assert!(matches!(err, GitError::OperationFailed(_)));

        let empty_target = parent.path().join("existing-branch");
        let existing_branch = test_repo
            .repo
            .head()
            .unwrap()
            .shorthand()
            .unwrap()
            .to_string();
        let err = GitEngine::create_worktree(
            test_repo.path_str(),
            empty_target.to_str().unwrap(),
            &existing_branch,
            None,
            false,
            &oid.to_string(),
        )
        .unwrap_err();
        assert!(matches!(err, GitError::OperationFailed(_)));
    }

    #[test]
    fn rejects_a_start_branch_that_moved_after_selection() {
        let test_repo = TestRepo::new();
        let original = head_oid(&test_repo.repo);
        let original_commit = test_repo.repo.find_commit(original).unwrap();
        test_repo
            .repo
            .branch("base/moving", &original_commit, false)
            .unwrap();
        drop(original_commit);
        let moved = commit_file(&test_repo, "moved", "moved.txt", "moved\n");
        test_repo
            .repo
            .reference("refs/heads/base/moving", moved, true, "move test branch")
            .unwrap();
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("stale-start");

        let error = GitEngine::create_worktree(
            test_repo.path_str(),
            target.to_str().unwrap(),
            "feature/stale-start",
            Some("base/moving"),
            false,
            &original.to_string(),
        )
        .unwrap_err();

        assert!(error.to_string().contains("start point changed"));
        assert!(!target.exists());
        assert!(test_repo
            .repo
            .find_branch("feature/stale-start", BranchType::Local)
            .is_err());
    }
}
