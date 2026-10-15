use git2::{BranchType, Repository, RepositoryState, ResetType, StatusOptions};

use super::GitEngine;
use crate::git::error::{GitError, GitResult};

impl GitEngine {
    pub fn switch_and_reset_branch(
        path: &str,
        name: &str,
        oid: &str,
        mode: &str,
        expected_head: Option<&str>,
        expected_head_ref: &str,
        expected_branch_oid: &str,
    ) -> GitResult<()> {
        let repo = Self::open(path)?;
        Self::ensure_expected_head(&repo, expected_head, Some(expected_head_ref))?;
        if repo.state() != RepositoryState::Clean {
            return Err(GitError::OperationFailed(
                "仓库正在执行其他 Git 操作，无法切换并重置分支".into(),
            ));
        }
        let reset_type = match mode {
            "soft" => ResetType::Soft,
            "mixed" => ResetType::Mixed,
            "hard" => ResetType::Hard,
            _ => return Err(GitError::OperationFailed("未知的 reset 模式".into())),
        };
        let commit = repo.find_commit(git2::Oid::from_str(oid)?)?;
        let branch = repo.find_branch(name, BranchType::Local)?;
        let branch_oid = branch.get().target().ok_or_else(|| {
            GitError::OperationFailed("所选本地分支不是直接引用，请重新打开表单".into())
        })?;
        if branch_oid.to_string() != expected_branch_oid {
            return Err(GitError::OperationFailed(
                "所选本地分支已变化，请重新打开表单".into(),
            ));
        }
        let refname = format!("refs/heads/{name}");
        ensure_branch_available(&repo, &refname)?;
        let mut status_options = StatusOptions::new();
        status_options
            .include_untracked(true)
            .recurse_untracked_dirs(true);
        if !repo.statuses(Some(&mut status_options))?.is_empty() {
            return Err(GitError::OperationFailed(
                "请先提交或 Stash 未提交改动，再切换并重置分支".into(),
            ));
        }
        // Status collection can take time in a large worktree; recheck refs
        // immediately before the first write.
        Self::ensure_expected_head(&repo, expected_head, Some(expected_head_ref))?;
        if repo.find_reference(&refname)?.target() != Some(branch_oid) {
            return Err(GitError::OperationFailed(
                "所选本地分支已变化，请重新打开表单".into(),
            ));
        }

        // All predictable failures are checked before switching. Soft / Mixed
        // preserve the selected branch's tree, rather than the source branch's.
        if repo
            .head()
            .ok()
            .and_then(|head| head.name().map(str::to_owned))
            .as_deref()
            != Some(refname.as_str())
        {
            let branch_commit = repo.find_commit(branch_oid)?;
            repo.checkout_tree(
                branch_commit.as_object(),
                Some(git2::build::CheckoutBuilder::new().safe()),
            )?;
            repo.set_head(&refname)?;
        }
        Self::ensure_expected_head(&repo, Some(expected_branch_oid), Some(&refname))?;
        repo.reset(commit.as_object(), reset_type, None)?;
        Ok(())
    }
}

fn ensure_branch_available(repo: &Repository, refname: &str) -> GitResult<()> {
    let common = Repository::open(repo.commondir())?;
    let mut other_repos = vec![common];
    for name in repo.worktrees()?.iter().flatten() {
        let worktree = repo.find_worktree(name)?;
        other_repos.push(Repository::open_from_worktree(&worktree)?);
    }
    let current_dir = repo.path().canonicalize()?;
    for other in other_repos {
        if other.path().canonicalize()? != current_dir
            && other.find_reference("HEAD")?.symbolic_target() == Some(refname)
        {
            return Err(GitError::OperationFailed(
                "所选分支已在其他 Worktree 中检出，无法切换并重置".into(),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_utils::TestRepo;
    use std::{fs, path::Path};

    struct Fixture {
        repo: TestRepo,
        base: String,
        source: String,
        source_ref: String,
        branch: String,
    }

    impl Fixture {
        fn new() -> Self {
            let repo = TestRepo::new();
            let base = repo.repo.head().unwrap().target().unwrap().to_string();
            let source_ref = repo.repo.head().unwrap().name().unwrap().to_string();
            let branch = commit_content(&repo, "target\n").to_string();
            repo.repo
                .branch(
                    "feature",
                    &repo
                        .repo
                        .find_commit(git2::Oid::from_str(&branch).unwrap())
                        .unwrap(),
                    false,
                )
                .unwrap();
            let source = commit_content(&repo, "source\n").to_string();
            Self {
                repo,
                base,
                source,
                source_ref,
                branch,
            }
        }

        fn reset(&self, mode: &str) -> GitResult<()> {
            GitEngine::switch_and_reset_branch(
                self.repo.path_str(),
                "feature",
                &self.base,
                mode,
                Some(&self.source),
                &self.source_ref,
                &self.branch,
            )
        }

        fn assert_unchanged(&self) {
            let repo = &self.repo.repo;
            assert_eq!(repo.head().unwrap().name(), Some(self.source_ref.as_str()));
            assert_eq!(
                repo.head().unwrap().target().unwrap().to_string(),
                self.source
            );
        }
    }

    fn commit_content(test: &TestRepo, content: &str) -> git2::Oid {
        fs::write(test.dir.path().join("existing.txt"), content).unwrap();
        let repo = &test.repo;
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("existing.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        let sig = repo.signature().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, content, &tree, &[&parent])
            .unwrap()
    }

    #[test]
    fn switches_and_resets_with_the_selected_branch_tree_for_each_mode() {
        for mode in ["soft", "mixed", "hard"] {
            let fixture = Fixture::new();
            fixture.reset(mode).unwrap();
            // Reopen so assertions read the index written by the operation,
            // rather than the fixture handle's cached pre-checkout index.
            let repo = Repository::open(fixture.repo.path_str()).unwrap();
            assert_eq!(repo.head().unwrap().name(), Some("refs/heads/feature"));
            assert_eq!(
                repo.head().unwrap().target().unwrap().to_string(),
                fixture.base
            );
            assert_eq!(
                repo.find_reference(&fixture.source_ref)
                    .unwrap()
                    .target()
                    .unwrap()
                    .to_string(),
                fixture.source
            );
            let entry = repo
                .index()
                .unwrap()
                .get_path(Path::new("existing.txt"), 0)
                .unwrap();
            assert_eq!(
                repo.find_blob(entry.id).unwrap().content(),
                if mode == "soft" {
                    b"target\n".as_slice()
                } else {
                    b"hello\n".as_slice()
                }
            );
            assert_eq!(
                fs::read(fixture.repo.dir.path().join("existing.txt")).unwrap(),
                if mode == "hard" {
                    b"hello\n".as_slice()
                } else {
                    b"target\n".as_slice()
                }
            );
        }
    }

    #[test]
    fn supports_current_branch_and_detached_head() {
        let fixture = Fixture::new();
        GitEngine::switch_and_reset_branch(
            fixture.repo.path_str(),
            fixture.source_ref.strip_prefix("refs/heads/").unwrap(),
            &fixture.base,
            "hard",
            Some(&fixture.source),
            &fixture.source_ref,
            &fixture.source,
        )
        .unwrap();
        assert_eq!(
            fixture.repo.repo.head().unwrap().name(),
            Some(fixture.source_ref.as_str())
        );
        assert_eq!(
            fixture
                .repo
                .repo
                .head()
                .unwrap()
                .target()
                .unwrap()
                .to_string(),
            fixture.base
        );

        let fixture = Fixture::new();
        fixture
            .repo
            .repo
            .set_head_detached(git2::Oid::from_str(&fixture.source).unwrap())
            .unwrap();
        GitEngine::switch_and_reset_branch(
            fixture.repo.path_str(),
            "feature",
            &fixture.base,
            "hard",
            Some(&fixture.source),
            "HEAD",
            &fixture.branch,
        )
        .unwrap();
        assert_eq!(
            fixture.repo.repo.head().unwrap().name(),
            Some("refs/heads/feature")
        );
    }

    #[test]
    fn rejects_stale_context_invalid_targets_and_modes_before_switching() {
        for scenario in [
            "head", "head-ref", "branch", "deleted", "remote", "mode", "commit",
        ] {
            let fixture = Fixture::new();
            if scenario == "deleted" {
                fixture
                    .repo
                    .repo
                    .find_branch("feature", BranchType::Local)
                    .unwrap()
                    .delete()
                    .unwrap();
            }
            if scenario == "remote" {
                fixture
                    .repo
                    .repo
                    .reference(
                        "refs/remotes/origin/main",
                        git2::Oid::from_str(&fixture.branch).unwrap(),
                        false,
                        "test",
                    )
                    .unwrap();
            }
            let result = GitEngine::switch_and_reset_branch(
                fixture.repo.path_str(),
                if scenario == "remote" {
                    "origin/main"
                } else {
                    "feature"
                },
                if scenario == "commit" {
                    &fixture.source_ref
                } else {
                    &fixture.base
                },
                if scenario == "mode" {
                    "invalid"
                } else {
                    "hard"
                },
                Some(if scenario == "head" {
                    &fixture.base
                } else {
                    &fixture.source
                }),
                if scenario == "head-ref" {
                    "refs/heads/other"
                } else {
                    &fixture.source_ref
                },
                if scenario == "branch" {
                    &fixture.base
                } else {
                    &fixture.branch
                },
            );
            assert!(result.is_err(), "{scenario}");
            fixture.assert_unchanged();
            assert_eq!(
                fs::read_to_string(fixture.repo.dir.path().join("existing.txt")).unwrap(),
                "source\n"
            );
        }
    }

    #[test]
    fn rejects_dirty_worktree_and_ongoing_operations_before_switching() {
        for scenario in ["staged", "unstaged", "untracked", "merge"] {
            let fixture = Fixture::new();
            match scenario {
                "staged" | "unstaged" => {
                    fs::write(fixture.repo.dir.path().join("existing.txt"), "dirty\n").unwrap();
                    if scenario == "staged" {
                        let mut index = fixture.repo.repo.index().unwrap();
                        index.add_path(Path::new("existing.txt")).unwrap();
                        index.write().unwrap();
                    }
                }
                "untracked" => {
                    fs::write(fixture.repo.dir.path().join("untracked.txt"), "keep\n").unwrap();
                }
                _ => {
                    fs::write(fixture.repo.repo.path().join("MERGE_HEAD"), &fixture.base).unwrap();
                }
            }
            assert!(fixture.reset("hard").is_err(), "{scenario}");
            fixture.assert_unchanged();
            if scenario == "staged" || scenario == "unstaged" {
                assert_eq!(
                    fs::read_to_string(fixture.repo.dir.path().join("existing.txt")).unwrap(),
                    "dirty\n"
                );
            }
        }
    }

    #[test]
    fn rejects_branches_checked_out_in_another_worktree_in_both_directions() {
        let fixture = Fixture::new();
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("linked");
        let reference = fixture
            .repo
            .repo
            .find_reference("refs/heads/feature")
            .unwrap();
        let mut options = git2::WorktreeAddOptions::new();
        options.reference(Some(&reference));
        fixture
            .repo
            .repo
            .worktree("linked", &target, Some(&options))
            .unwrap();

        assert!(fixture
            .reset("hard")
            .unwrap_err()
            .to_string()
            .contains("Worktree"));
        fixture.assert_unchanged();
        let error = GitEngine::switch_and_reset_branch(
            target.to_str().unwrap(),
            fixture.source_ref.strip_prefix("refs/heads/").unwrap(),
            &fixture.base,
            "hard",
            Some(&fixture.branch),
            "refs/heads/feature",
            &fixture.source,
        )
        .unwrap_err();
        assert!(error.to_string().contains("Worktree"));
        assert_eq!(
            Repository::open(target).unwrap().head().unwrap().name(),
            Some("refs/heads/feature")
        );
    }
}
