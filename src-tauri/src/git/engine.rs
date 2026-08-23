use git2::{Repository, Signature};
use std::path::Path;

use crate::git::{
    encoding::decode_commit_text,
    error::{GitError, GitResult},
    types::*,
};

mod diff;
mod history;
mod patch;
mod refs;
mod remote;
mod stash_reflog;
mod submodule;
mod workspace;
mod worktree;

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
    use git2::{IndexEntry, IndexTime, Oid, StashFlags};
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

    #[test]
    fn pull_guard_accepts_clean_repository() {
        let test_repo = TestRepo::new();

        assert!(GitEngine::ensure_pull_ready(&test_repo.repo).is_ok());
    }

    #[test]
    fn pull_guard_rejects_tracked_changes() {
        let test_repo = TestRepo::new();
        fs::write(test_repo.dir.path().join("existing.txt"), "changed\n").unwrap();

        let error = GitEngine::ensure_pull_ready(&test_repo.repo).unwrap_err();
        assert!(error.to_string().contains("Cannot pull"));
    }

    #[test]
    fn pull_guard_rejects_untracked_files() {
        let test_repo = TestRepo::new();
        fs::write(test_repo.dir.path().join("untracked.txt"), "local\n").unwrap();

        let error = GitEngine::ensure_pull_ready(&test_repo.repo).unwrap_err();
        assert!(error.to_string().contains("Cannot pull"));
    }

    #[test]
    fn pull_guard_rejects_an_unfinished_git_operation() {
        let test_repo = TestRepo::new();
        let head_oid = test_repo.repo.head().unwrap().target().unwrap();
        fs::write(
            test_repo.repo.path().join("MERGE_HEAD"),
            format!("{head_oid}\n"),
        )
        .unwrap();

        let error = GitEngine::ensure_pull_ready(&test_repo.repo).unwrap_err();
        assert!(error.to_string().contains("unfinished Git operation"));
    }

    #[test]
    fn push_publishes_branch_and_establishes_upstream() {
        let test_repo = TestRepo::new();
        let remote_dir = tempfile::tempdir().unwrap();
        let remote_repo = Repository::init_bare(remote_dir.path()).unwrap();
        test_repo
            .repo
            .remote("origin", remote_dir.path().to_str().unwrap())
            .unwrap();
        let branch_name = test_repo
            .repo
            .head()
            .unwrap()
            .shorthand()
            .unwrap()
            .to_string();
        let local_oid = test_repo.repo.head().unwrap().target().unwrap();

        GitEngine::push(test_repo.path_str(), "origin", &branch_name, "normal").unwrap();

        let local_branch = test_repo
            .repo
            .find_branch(&branch_name, git2::BranchType::Local)
            .unwrap();
        assert_eq!(
            local_branch.upstream().unwrap().name().unwrap(),
            Some(format!("origin/{branch_name}").as_str())
        );
        assert_eq!(
            remote_repo
                .find_reference(&format!("refs/heads/{branch_name}"))
                .unwrap()
                .target(),
            Some(local_oid)
        );
    }

    #[test]
    fn tag_info_keeps_exact_ref_oid_separate_from_peeled_commit() {
        let test_repo = TestRepo::new();
        let head_oid = test_repo.repo.head().unwrap().target().unwrap();
        GitEngine::create_tag(test_repo.path_str(), "light", &head_oid.to_string(), None).unwrap();
        GitEngine::create_tag(
            test_repo.path_str(),
            "annotated",
            &head_oid.to_string(),
            Some("release"),
        )
        .unwrap();

        let tags = GitEngine::list_tags(test_repo.path_str()).unwrap();
        let light = tags.iter().find(|tag| tag.name == "light").unwrap();
        assert_eq!(light.ref_oid, head_oid.to_string());
        assert_eq!(light.commit_oid, head_oid.to_string());

        let annotated = tags.iter().find(|tag| tag.name == "annotated").unwrap();
        assert_ne!(annotated.ref_oid, annotated.commit_oid);
        assert_eq!(annotated.commit_oid, head_oid.to_string());
        assert!(test_repo
            .repo
            .find_tag(Oid::from_str(&annotated.ref_oid).unwrap())
            .is_ok());
    }

    #[test]
    fn guarded_force_push_tag_rejects_changed_local_or_remote_targets() {
        let test_repo = TestRepo::new();
        let remote_dir = tempfile::tempdir().unwrap();
        let remote_repo = Repository::init_bare(remote_dir.path()).unwrap();
        test_repo
            .repo
            .remote("origin", remote_dir.path().to_str().unwrap())
            .unwrap();
        let initial_oid = test_repo.repo.head().unwrap().target().unwrap();
        GitEngine::create_tag(test_repo.path_str(), "v1", &initial_oid.to_string(), None).unwrap();
        let initial_tag_oid = test_repo
            .repo
            .find_reference("refs/tags/v1")
            .unwrap()
            .target()
            .unwrap();
        GitEngine::push_tag(
            test_repo.path_str(),
            "origin",
            "v1",
            false,
            Some(&initial_tag_oid.to_string()),
            None,
            false,
        )
        .unwrap();

        let next_oid = commit_file(&test_repo, "next", "next.txt", "next\n");
        test_repo.repo.tag_delete("v1").unwrap();
        let next_object = test_repo.repo.find_object(next_oid, None).unwrap();
        test_repo
            .repo
            .tag_lightweight("v1", &next_object, false)
            .unwrap();
        drop(next_object);

        let local_error = GitEngine::push_tag(
            test_repo.path_str(),
            "origin",
            "v1",
            true,
            Some(&initial_tag_oid.to_string()),
            Some(&initial_tag_oid.to_string()),
            true,
        )
        .unwrap_err();
        assert!(local_error.to_string().contains("Tag target changed"));
        assert_eq!(
            remote_repo.find_reference("refs/tags/v1").unwrap().target(),
            Some(initial_tag_oid)
        );

        let remote_error = GitEngine::push_tag(
            test_repo.path_str(),
            "origin",
            "v1",
            true,
            Some(&next_oid.to_string()),
            Some(&next_oid.to_string()),
            true,
        )
        .unwrap_err();
        assert!(remote_error
            .to_string()
            .contains("Remote tag target changed"));
        assert_eq!(
            remote_repo.find_reference("refs/tags/v1").unwrap().target(),
            Some(initial_tag_oid)
        );

        GitEngine::push_tag(
            test_repo.path_str(),
            "origin",
            "v1",
            true,
            Some(&next_oid.to_string()),
            Some(&initial_tag_oid.to_string()),
            true,
        )
        .unwrap();
        assert_eq!(
            remote_repo.find_reference("refs/tags/v1").unwrap().target(),
            Some(next_oid)
        );
    }

    #[test]
    fn guarded_tag_delete_rejects_changed_local_or_remote_targets() {
        let test_repo = TestRepo::new();
        let remote_dir = tempfile::tempdir().unwrap();
        let remote_repo = Repository::init_bare(remote_dir.path()).unwrap();
        test_repo
            .repo
            .remote("origin", remote_dir.path().to_str().unwrap())
            .unwrap();
        let initial_oid = test_repo.repo.head().unwrap().target().unwrap();
        GitEngine::create_tag(test_repo.path_str(), "v1", &initial_oid.to_string(), None).unwrap();
        let initial_tag_oid = test_repo
            .repo
            .find_reference("refs/tags/v1")
            .unwrap()
            .target()
            .unwrap();

        let next_oid = commit_file(&test_repo, "next", "next-delete.txt", "next\n");
        test_repo.repo.tag_delete("v1").unwrap();
        let next_object = test_repo.repo.find_object(next_oid, None).unwrap();
        test_repo
            .repo
            .tag_lightweight("v1", &next_object, false)
            .unwrap();
        drop(next_object);

        let local_error = GitEngine::delete_tag(
            test_repo.path_str(),
            "v1",
            Some(&initial_tag_oid.to_string()),
        )
        .unwrap_err();
        assert!(local_error.to_string().contains("Tag target changed"));
        assert_eq!(
            test_repo
                .repo
                .find_reference("refs/tags/v1")
                .unwrap()
                .target(),
            Some(next_oid)
        );

        GitEngine::push_tag(
            test_repo.path_str(),
            "origin",
            "v1",
            false,
            Some(&next_oid.to_string()),
            None,
            false,
        )
        .unwrap();
        remote_repo
            .reference("refs/tags/v1", initial_oid, true, "move remote tag")
            .unwrap();

        let remote_error = GitEngine::delete_remote_tag(
            test_repo.path_str(),
            "origin",
            "v1",
            Some(&next_oid.to_string()),
        )
        .unwrap_err();
        assert!(remote_error
            .to_string()
            .contains("Remote tag target changed"));
        assert_eq!(
            remote_repo.find_reference("refs/tags/v1").unwrap().target(),
            Some(initial_oid)
        );

        GitEngine::delete_remote_tag(
            test_repo.path_str(),
            "origin",
            "v1",
            Some(&initial_oid.to_string()),
        )
        .unwrap();
        assert!(remote_repo.find_reference("refs/tags/v1").is_err());

        GitEngine::delete_tag(test_repo.path_str(), "v1", Some(&next_oid.to_string())).unwrap();
        assert!(test_repo.repo.find_reference("refs/tags/v1").is_err());
    }

    #[test]
    fn push_keeps_an_existing_upstream_when_using_another_remote() {
        let test_repo = TestRepo::new();
        let origin_dir = tempfile::tempdir().unwrap();
        let backup_dir = tempfile::tempdir().unwrap();
        Repository::init_bare(origin_dir.path()).unwrap();
        Repository::init_bare(backup_dir.path()).unwrap();
        test_repo
            .repo
            .remote("origin", origin_dir.path().to_str().unwrap())
            .unwrap();
        test_repo
            .repo
            .remote("backup", backup_dir.path().to_str().unwrap())
            .unwrap();
        let branch_name = test_repo
            .repo
            .head()
            .unwrap()
            .shorthand()
            .unwrap()
            .to_string();

        GitEngine::push(test_repo.path_str(), "origin", &branch_name, "normal").unwrap();
        GitEngine::push(test_repo.path_str(), "backup", &branch_name, "normal").unwrap();

        let local_branch = test_repo
            .repo
            .find_branch(&branch_name, git2::BranchType::Local)
            .unwrap();
        assert_eq!(
            local_branch.upstream().unwrap().name().unwrap(),
            Some(format!("origin/{branch_name}").as_str())
        );
    }

    #[test]
    fn failed_push_does_not_establish_upstream() {
        let test_repo = TestRepo::new();
        let missing_remote = test_repo.dir.path().join("missing-remote.git");
        test_repo
            .repo
            .remote("origin", missing_remote.to_str().unwrap())
            .unwrap();
        let branch_name = test_repo
            .repo
            .head()
            .unwrap()
            .shorthand()
            .unwrap()
            .to_string();

        assert!(GitEngine::push(test_repo.path_str(), "origin", &branch_name, "normal").is_err());

        let local_branch = test_repo
            .repo
            .find_branch(&branch_name, git2::BranchType::Local)
            .unwrap();
        assert!(local_branch.upstream().is_err());
    }

    #[test]
    fn configured_missing_upstream_is_preserved_and_reported() {
        let test_repo = TestRepo::new();
        let branch_name = test_repo
            .repo
            .head()
            .unwrap()
            .shorthand()
            .unwrap()
            .to_string();
        let mut config = test_repo.repo.config().unwrap();
        config
            .set_str(&format!("branch.{branch_name}.remote"), "origin")
            .unwrap();
        config
            .set_str(
                &format!("branch.{branch_name}.merge"),
                &format!("refs/heads/{branch_name}"),
            )
            .unwrap();
        drop(config);

        assert!(
            !GitEngine::set_upstream_after_push(test_repo.path_str(), "backup", &branch_name)
                .unwrap()
        );
        let branch = GitEngine::list_branches(test_repo.path_str())
            .unwrap()
            .into_iter()
            .find(|branch| branch.name == branch_name)
            .unwrap();
        assert_eq!(branch.upstream, Some(format!("origin/{branch_name}")));
        assert_eq!(branch.ahead, None);
        assert_eq!(branch.behind, None);
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

    fn commit_gitlink(test_repo: &TestRepo, message: &str, path: &str) -> Oid {
        let repo = &test_repo.repo;
        let target_oid = repo.head().unwrap().target().unwrap();
        let mut index = repo.index().unwrap();
        index
            .add(&IndexEntry {
                ctime: IndexTime::new(0, 0),
                mtime: IndexTime::new(0, 0),
                dev: 0,
                ino: 0,
                mode: 0o160000,
                uid: 0,
                gid: 0,
                file_size: 0,
                id: target_oid,
                flags: 0,
                flags_extended: 0,
                path: path.as_bytes().to_vec(),
            })
            .unwrap();
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

        let staged = GitEngine::get_file_diff(path, "existing.txt", true, false).unwrap();
        let staged_content = diff_contents(&staged);
        assert!(staged_content.contains("LINE2\n"));
        assert!(!staged_content.contains("LINE12\n"));

        let unstaged = GitEngine::get_file_diff(path, "existing.txt", false, false).unwrap();
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

        let staged = GitEngine::get_file_diff(path, "existing.txt", true, false).unwrap();
        let staged_content = diff_contents(&staged);
        assert!(!staged_content.contains("LINE2\n"));
        assert!(staged_content.contains("LINE12\n"));

        let unstaged = GitEngine::get_file_diff(path, "existing.txt", false, false).unwrap();
        let unstaged_content = diff_contents(&unstaged);
        assert!(unstaged_content.contains("LINE2\n"));
        assert!(!unstaged_content.contains("LINE12\n"));
    }

    #[test]
    fn test_discard_file_keeps_staged_changes() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let trash_dir = tempfile::tempdir().unwrap();
        let mut moved = Vec::new();
        let base = multiline_base();
        commit_file(&test_repo, "base", "existing.txt", &base);

        let staged = base.replace("line2\n", "LINE2\n");
        fs::write(test_repo.dir.path().join("existing.txt"), &staged).unwrap();
        GitEngine::stage_file(path, "existing.txt").unwrap();

        let unstaged = staged.replace("line12\n", "LINE12\n");
        fs::write(test_repo.dir.path().join("existing.txt"), unstaged).unwrap();

        GitEngine::discard_files_with(path, &["existing.txt".to_string()], |source| {
            let destination = trash_dir.path().join(moved.len().to_string());
            fs::rename(source, &destination)?;
            moved.push(destination);
            Ok(())
        })
        .unwrap();

        let worktree = fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap();
        assert!(worktree.contains("LINE2\n"));
        assert!(!worktree.contains("LINE12\n"));
        assert!(fs::read_to_string(&moved[0]).unwrap().contains("LINE12\n"));

        let status = GitEngine::get_status(path).unwrap();
        assert_eq!(status.staged.len(), 1);
        assert!(status.unstaged.is_empty());
    }

    #[test]
    fn test_discard_file_removes_untracked_file() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let trash_dir = tempfile::tempdir().unwrap();
        let mut moved = Vec::new();
        let target = test_repo.dir.path().join("new.txt");
        fs::write(&target, "new\n").unwrap();

        GitEngine::discard_files_with(path, &["new.txt".to_string()], |source| {
            let destination = trash_dir.path().join(moved.len().to_string());
            fs::rename(source, &destination)?;
            moved.push(destination);
            Ok(())
        })
        .unwrap();

        assert!(!target.exists());
        assert_eq!(fs::read_to_string(&moved[0]).unwrap(), "new\n");
    }

    #[test]
    fn test_discard_files_batches_tracked_and_untracked_paths() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let trash_dir = tempfile::tempdir().unwrap();
        let mut moved = Vec::new();
        commit_file(&test_repo, "base", "existing.txt", "base\n");
        fs::write(test_repo.dir.path().join("existing.txt"), "changed\n").unwrap();
        fs::write(test_repo.dir.path().join("new.txt"), "new\n").unwrap();

        GitEngine::discard_files_with(
            path,
            &["existing.txt".to_string(), "new.txt".to_string()],
            |source| {
                let destination = trash_dir.path().join(moved.len().to_string());
                fs::rename(source, &destination)?;
                moved.push(destination);
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap(),
            "base\n"
        );
        assert!(!test_repo.dir.path().join("new.txt").exists());
        let discarded = moved
            .iter()
            .map(|path| fs::read_to_string(path).unwrap())
            .collect::<Vec<_>>();
        assert!(discarded.contains(&"changed\n".to_string()));
        assert!(discarded.contains(&"new\n".to_string()));
    }

    #[test]
    fn test_discard_all_moves_originals_to_trash_and_restores_head() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let trash_dir = tempfile::tempdir().unwrap();
        let mut moved = Vec::new();
        commit_file(&test_repo, "base", "existing.txt", "base\n");
        commit_file(&test_repo, "ignore", ".gitignore", "ignored.log\n");

        fs::write(test_repo.dir.path().join("existing.txt"), "staged\n").unwrap();
        GitEngine::stage_file(path, "existing.txt").unwrap();
        fs::write(test_repo.dir.path().join("existing.txt"), "unstaged\n").unwrap();
        fs::write(test_repo.dir.path().join("staged-new.txt"), "staged new\n").unwrap();
        GitEngine::stage_file(path, "staged-new.txt").unwrap();
        fs::write(test_repo.dir.path().join("untracked.txt"), "untracked\n").unwrap();
        fs::write(test_repo.dir.path().join("ignored.log"), "ignored\n").unwrap();

        GitEngine::discard_all_changes_with(path, |source| {
            let destination = trash_dir.path().join(moved.len().to_string());
            fs::rename(source, &destination)?;
            moved.push(destination);
            Ok(())
        })
        .unwrap();

        assert_eq!(
            fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap(),
            "base\n"
        );
        assert!(!test_repo.dir.path().join("staged-new.txt").exists());
        assert!(!test_repo.dir.path().join("untracked.txt").exists());
        assert_eq!(
            fs::read_to_string(test_repo.dir.path().join("ignored.log")).unwrap(),
            "ignored\n"
        );
        let status = GitEngine::get_status(path).unwrap();
        assert!(status.staged.is_empty());
        assert!(status.unstaged.is_empty());
        assert!(status.untracked.is_empty());
        let discarded = moved
            .iter()
            .map(|path| fs::read_to_string(path).unwrap())
            .collect::<Vec<_>>();
        assert!(discarded.contains(&"unstaged\n".to_string()));
        assert!(discarded.contains(&"staged new\n".to_string()));
        assert!(discarded.contains(&"untracked\n".to_string()));
    }

    #[test]
    fn test_discard_stops_before_checkout_when_trash_fails() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        commit_file(&test_repo, "base", "existing.txt", "base\n");
        fs::write(test_repo.dir.path().join("existing.txt"), "keep me\n").unwrap();

        let error = GitEngine::discard_files_with(path, &["existing.txt".to_string()], |_| {
            Err(GitError::OperationFailed("trash unavailable".to_string()))
        })
        .unwrap_err();

        assert!(error.to_string().contains("trash unavailable"));
        assert_eq!(
            fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap(),
            "keep me\n"
        );
    }

    #[test]
    fn test_discard_all_clears_index_in_unborn_repository() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(repo_dir.path()).unwrap();
        let trash_dir = tempfile::tempdir().unwrap();
        let mut moved = Vec::new();
        fs::write(repo_dir.path().join("staged.txt"), "staged\n").unwrap();
        fs::write(repo_dir.path().join("untracked.txt"), "untracked\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("staged.txt")).unwrap();
        index.write().unwrap();
        drop(index);

        GitEngine::discard_all_changes_with(repo_dir.path().to_str().unwrap(), |source| {
            let destination = trash_dir.path().join(moved.len().to_string());
            fs::rename(source, &destination)?;
            moved.push(destination);
            Ok(())
        })
        .unwrap();

        assert!(git2::Repository::open(repo_dir.path())
            .unwrap()
            .index()
            .unwrap()
            .is_empty());
        assert!(!repo_dir.path().join("staged.txt").exists());
        assert!(!repo_dir.path().join("untracked.txt").exists());
        assert_eq!(moved.len(), 2);
    }

    #[test]
    fn test_discard_does_not_move_submodule_workdir_to_trash() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        commit_gitlink(&test_repo, "gitlink", "module");
        let module_dir = test_repo.dir.path().join("module");
        fs::create_dir(&module_dir).unwrap();
        fs::write(module_dir.join("local.txt"), "local\n").unwrap();
        let mut move_count = 0;

        GitEngine::discard_files_with(path, &["module".to_string()], |_| {
            move_count += 1;
            Ok(())
        })
        .unwrap();

        assert_eq!(move_count, 0);
        assert_eq!(
            fs::read_to_string(module_dir.join("local.txt")).unwrap(),
            "local\n"
        );
    }

    #[test]
    fn test_stage_and_unstage_files_batch_changes_including_deletion() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        commit_file(&test_repo, "add deleted file", "deleted.txt", "delete me\n");
        fs::write(test_repo.dir.path().join("existing.txt"), "changed\n").unwrap();
        fs::write(test_repo.dir.path().join("new.txt"), "new\n").unwrap();
        fs::remove_file(test_repo.dir.path().join("deleted.txt")).unwrap();
        let paths = vec![
            "existing.txt".to_string(),
            "new.txt".to_string(),
            "deleted.txt".to_string(),
        ];

        GitEngine::stage_files(path, &paths).unwrap();

        let staged_status = GitEngine::get_status(path).unwrap();
        let staged_paths = staged_status
            .staged
            .iter()
            .map(|file| file.path.as_str())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(staged_paths.len(), 3);
        assert!(staged_paths.contains("existing.txt"));
        assert!(staged_paths.contains("new.txt"));
        assert!(staged_paths.contains("deleted.txt"));

        GitEngine::unstage_files(path, &paths).unwrap();

        let unstaged_status = GitEngine::get_status(path).unwrap();
        assert!(unstaged_status.staged.is_empty());
        assert!(unstaged_status
            .unstaged
            .iter()
            .any(|file| file.path == "existing.txt"));
        assert!(unstaged_status
            .unstaged
            .iter()
            .any(|file| file.path == "deleted.txt"));
        assert!(unstaged_status
            .untracked
            .iter()
            .any(|file| file.path == "new.txt"));
    }

    #[test]
    fn test_unstage_files_removes_only_selected_paths_without_head() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(repo_dir.path()).unwrap();
        fs::write(repo_dir.path().join("one.txt"), "one\n").unwrap();
        fs::write(repo_dir.path().join("two.txt"), "two\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("one.txt")).unwrap();
        index.add_path(Path::new("two.txt")).unwrap();
        index.write().unwrap();
        drop(index);

        GitEngine::unstage_files(repo_dir.path().to_str().unwrap(), &["one.txt".to_string()])
            .unwrap();

        let refreshed_repo = git2::Repository::open(repo_dir.path()).unwrap();
        let refreshed_index = refreshed_repo.index().unwrap();
        assert!(refreshed_index.get_path(Path::new("one.txt"), 0).is_none());
        assert!(refreshed_index.get_path(Path::new("two.txt"), 0).is_some());
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

        let staged = GitEngine::get_file_diff(path, "existing.txt", true, false).unwrap();
        let staged_content = diff_contents(&staged);
        assert!(!staged_content.contains("LINE2\n"));
        assert!(staged_content.contains("LINE12\n"));

        let worktree = fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap();
        assert!(!worktree.contains("LINE2\n"));
        assert!(worktree.contains("LINE12\n"));
    }

    #[test]
    fn test_apply_patch_discards_later_unstaged_hunk_after_prior_insertion() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let base = (1..=24)
            .map(|i| format!("line{i}\n"))
            .collect::<Vec<_>>()
            .join("");
        commit_file(&test_repo, "base", "existing.txt", &base);

        let modified = base
            .replace("line4\n", "line4\ninserted\n")
            .replace("line16\n", "LINE16\n");
        fs::write(test_repo.dir.path().join("existing.txt"), modified).unwrap();

        let patch = concat!(
            "diff --git a/existing.txt b/existing.txt\n",
            "--- a/existing.txt\n",
            "+++ b/existing.txt\n",
            "@@ -14,7 +14,7 @@\n",
            " line13\n",
            " line14\n",
            " line15\n",
            "-LINE16\n",
            "+line16\n",
            " line17\n",
            " line18\n",
            " line19\n",
        );

        GitEngine::apply_patch(path, patch).unwrap();

        let worktree = fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap();
        assert!(worktree.contains("inserted\n"));
        assert!(worktree.contains("line16\n"));
        assert!(!worktree.contains("LINE16\n"));
    }

    #[test]
    fn test_apply_patch_to_index_stages_later_hunk_after_prior_insertion() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let base = (1..=24)
            .map(|i| format!("line{i}\n"))
            .collect::<Vec<_>>()
            .join("");
        commit_file(&test_repo, "base", "existing.txt", &base);

        let modified = base
            .replace("line4\n", "line4\ninserted\n")
            .replace("line16\n", "LINE16\n");
        fs::write(test_repo.dir.path().join("existing.txt"), modified).unwrap();

        let patch = concat!(
            "diff --git a/existing.txt b/existing.txt\n",
            "--- a/existing.txt\n",
            "+++ b/existing.txt\n",
            "@@ -13,7 +13,7 @@\n",
            " line13\n",
            " line14\n",
            " line15\n",
            "-line16\n",
            "+LINE16\n",
            " line17\n",
            " line18\n",
            " line19\n",
        );

        GitEngine::apply_patch_to_index(path, patch).unwrap();

        let staged = GitEngine::get_file_diff(path, "existing.txt", true, false).unwrap();
        let staged_content = diff_contents(&staged);
        assert!(staged_content.contains("LINE16\n"));
        assert!(!staged_content.contains("inserted\n"));
    }

    #[test]
    fn test_apply_patch_to_index_unstages_later_hunk_after_prior_insertion() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let base = (1..=24)
            .map(|i| format!("line{i}\n"))
            .collect::<Vec<_>>()
            .join("");
        commit_file(&test_repo, "base", "existing.txt", &base);

        let modified = base
            .replace("line4\n", "line4\ninserted\n")
            .replace("line16\n", "LINE16\n");
        fs::write(test_repo.dir.path().join("existing.txt"), modified).unwrap();
        GitEngine::stage_file(path, "existing.txt").unwrap();

        let patch = concat!(
            "diff --git a/existing.txt b/existing.txt\n",
            "--- a/existing.txt\n",
            "+++ b/existing.txt\n",
            "@@ -14,7 +14,7 @@\n",
            " line13\n",
            " line14\n",
            " line15\n",
            "-LINE16\n",
            "+line16\n",
            " line17\n",
            " line18\n",
            " line19\n",
        );

        GitEngine::apply_patch_to_index(path, patch).unwrap();

        let staged = GitEngine::get_file_diff(path, "existing.txt", true, false).unwrap();
        let staged_content = diff_contents(&staged);
        assert!(staged_content.contains("inserted\n"));
        assert!(!staged_content.contains("LINE16\n"));

        let unstaged = GitEngine::get_file_diff(path, "existing.txt", false, false).unwrap();
        let unstaged_content = diff_contents(&unstaged);
        assert!(unstaged_content.contains("LINE16\n"));
    }

    #[test]
    fn test_apply_patch_to_workdir_and_index_discards_later_hunk_after_prior_insertion() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let base = (1..=24)
            .map(|i| format!("line{i}\n"))
            .collect::<Vec<_>>()
            .join("");
        commit_file(&test_repo, "base", "existing.txt", &base);

        let modified = base
            .replace("line4\n", "line4\ninserted\n")
            .replace("line16\n", "LINE16\n");
        fs::write(test_repo.dir.path().join("existing.txt"), modified).unwrap();
        GitEngine::stage_file(path, "existing.txt").unwrap();

        let patch = concat!(
            "diff --git a/existing.txt b/existing.txt\n",
            "--- a/existing.txt\n",
            "+++ b/existing.txt\n",
            "@@ -14,7 +14,7 @@\n",
            " line13\n",
            " line14\n",
            " line15\n",
            "-LINE16\n",
            "+line16\n",
            " line17\n",
            " line18\n",
            " line19\n",
        );

        GitEngine::apply_patch_to_workdir_and_index(path, patch).unwrap();

        let staged = GitEngine::get_file_diff(path, "existing.txt", true, false).unwrap();
        let staged_content = diff_contents(&staged);
        assert!(staged_content.contains("inserted\n"));
        assert!(!staged_content.contains("LINE16\n"));

        let worktree = fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap();
        assert!(worktree.contains("inserted\n"));
        assert!(worktree.contains("line16\n"));
        assert!(!worktree.contains("LINE16\n"));
    }

    #[test]
    fn test_apply_patch_to_workdir_and_index_preserves_other_unstaged_hunks() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let base = (1..=24)
            .map(|i| format!("line{i}\n"))
            .collect::<Vec<_>>()
            .join("");
        commit_file(&test_repo, "base", "existing.txt", &base);

        let staged = base.replace("line16\n", "LINE16\n");
        fs::write(test_repo.dir.path().join("existing.txt"), &staged).unwrap();
        GitEngine::stage_file(path, "existing.txt").unwrap();

        let unstaged = staged
            .replace("line4\n", "line4\ninserted\n")
            .replace("line22\n", "LINE22\n");
        fs::write(test_repo.dir.path().join("existing.txt"), unstaged).unwrap();

        let patch = concat!(
            "diff --git a/existing.txt b/existing.txt\n",
            "--- a/existing.txt\n",
            "+++ b/existing.txt\n",
            "@@ -13,7 +13,7 @@\n",
            " line13\n",
            " line14\n",
            " line15\n",
            "-LINE16\n",
            "+line16\n",
            " line17\n",
            " line18\n",
            " line19\n",
        );

        GitEngine::apply_patch_to_workdir_and_index(path, patch).unwrap();

        let staged = GitEngine::get_file_diff(path, "existing.txt", true, false).unwrap();
        assert!(staged.hunks.is_empty());

        let worktree = fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap();
        assert!(worktree.contains("inserted\n"));
        assert!(worktree.contains("LINE22\n"));
        assert!(worktree.contains("line16\n"));
        assert!(!worktree.contains("LINE16\n"));
    }

    #[test]
    fn stash_pop_rejects_a_changed_expected_target_without_mutation() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        fs::write(test_repo.dir.path().join("existing.txt"), "stashed\n").unwrap();
        GitEngine::stash_push(path, Some("guarded stash")).unwrap();
        let entry = GitEngine::stash_list(path)
            .unwrap()
            .into_iter()
            .find(|stash| stash.index == 0)
            .unwrap();

        let error = GitEngine::stash_pop(path, 0, Some(&Oid::zero().to_string())).unwrap_err();

        assert!(error.to_string().contains("Stash target changed"));
        assert_eq!(GitEngine::stash_list(path).unwrap().len(), 1);
        assert_eq!(
            fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap(),
            "hello\n"
        );

        GitEngine::stash_pop(path, 0, Some(&entry.commit_oid)).unwrap();
        assert!(GitEngine::stash_list(path).unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap(),
            "stashed\n"
        );
    }

    #[test]
    fn stash_drop_rejects_a_changed_expected_target_without_deleting() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        fs::write(test_repo.dir.path().join("existing.txt"), "first stash\n").unwrap();
        GitEngine::stash_push(path, Some("first stash")).unwrap();
        fs::write(test_repo.dir.path().join("existing.txt"), "second stash\n").unwrap();
        GitEngine::stash_push(path, Some("second stash")).unwrap();
        let entries = GitEngine::stash_list(path).unwrap();
        let older = entries.iter().find(|stash| stash.index == 1).unwrap();

        let error = GitEngine::stash_drop(path, 0, Some(&older.commit_oid)).unwrap_err();

        assert!(error.to_string().contains("Stash target changed"));
        assert_eq!(GitEngine::stash_list(path).unwrap().len(), 2);

        GitEngine::stash_drop(path, 1, Some(&older.commit_oid)).unwrap();
        let remaining = GitEngine::stash_list(path).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_ne!(remaining[0].commit_oid, older.commit_oid);
    }

    #[test]
    fn confirmed_history_action_rejects_a_changed_head_without_resetting() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let initial = test_repo
            .repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id();
        let current = commit_file(&test_repo, "current", "current.txt", "current\n");

        let error = GitEngine::reset_to_commit(
            path,
            &initial.to_string(),
            "soft",
            Some(&initial.to_string()),
            None,
        )
        .unwrap_err();

        assert!(error
            .to_string()
            .contains("Confirmed Git action context changed"));
        assert_eq!(
            test_repo
                .repo
                .head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .id(),
            current
        );

        GitEngine::reset_to_commit(
            path,
            &initial.to_string(),
            "soft",
            Some(&current.to_string()),
            None,
        )
        .unwrap();
        assert_eq!(
            test_repo
                .repo
                .head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .id(),
            initial
        );
    }

    #[test]
    fn confirmed_history_action_rejects_the_same_oid_on_another_branch() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let initial = test_repo
            .repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id();
        let original_ref = test_repo.repo.head().unwrap().name().unwrap().to_string();
        let initial_commit = test_repo.repo.find_commit(initial).unwrap();
        test_repo
            .repo
            .branch("other", &initial_commit, false)
            .unwrap();
        drop(initial_commit);
        test_repo.repo.set_head("refs/heads/other").unwrap();

        let error = GitEngine::reset_to_commit(
            path,
            &initial.to_string(),
            "soft",
            Some(&initial.to_string()),
            Some(&original_ref),
        )
        .unwrap_err();

        assert!(error
            .to_string()
            .contains("Confirmed Git action context changed"));
        assert_eq!(
            test_repo.repo.head().unwrap().name(),
            Some("refs/heads/other")
        );
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
    fn test_commit_detail_includes_gitlink_file_mode() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let oid = commit_gitlink(&test_repo, "add submodule gitlink", "libs/child");

        let detail = GitEngine::get_commit_detail(path, &oid.to_string()).unwrap();
        let diff = detail
            .diffs
            .iter()
            .find(|d| d.new_path.as_deref() == Some("libs/child"))
            .expect("gitlink diff should be present");

        assert_eq!(diff.old_file_mode, None);
        assert_eq!(diff.new_file_mode, Some(0o160000));
    }

    #[test]
    fn test_get_status() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();

        // Add untracked file
        fs::write(test_repo.dir.path().join("new_file.txt"), "hello\ngitui\n").unwrap();

        // Add modified file
        fs::write(test_repo.dir.path().join("existing.txt"), "hello modified").unwrap();

        let status = GitEngine::get_status(path).expect("Failed to get status");
        assert_eq!(status.untracked.len(), 1);
        assert_eq!(status.untracked[0].path, "new_file.txt");
        assert_eq!(status.untracked[0].additions, 2);
        assert_eq!(status.untracked[0].deletions, 0);

        assert_eq!(status.unstaged.len(), 1);
        assert_eq!(status.unstaged[0].path, "existing.txt");
        assert_eq!(status.unstaged[0].additions, 1);
        assert_eq!(status.unstaged[0].deletions, 1);
    }

    #[test]
    fn test_file_diff_can_ignore_whitespace_only_changes() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        commit_file(
            &test_repo,
            "whitespace base",
            "existing.txt",
            "alpha\n  beta\n",
        );
        fs::write(
            test_repo.dir.path().join("existing.txt"),
            "alpha\n    beta\n",
        )
        .unwrap();

        let visible = GitEngine::get_file_diff(path, "existing.txt", false, false).unwrap();
        let ignored = GitEngine::get_file_diff(path, "existing.txt", false, true).unwrap();

        assert!(!visible.hunks.is_empty());
        assert_eq!((visible.additions, visible.deletions), (1, 1));
        assert!(ignored.hunks.is_empty());
        assert_eq!((ignored.additions, ignored.deletions), (0, 0));

        let whitespace_commit = commit_file(
            &test_repo,
            "whitespace only",
            "existing.txt",
            "alpha\n    beta\n",
        );
        let commit_visible = GitEngine::get_file_diff_at_commit(
            path,
            "existing.txt",
            &whitespace_commit.to_string(),
            false,
        )
        .unwrap();
        let commit_ignored = GitEngine::get_file_diff_at_commit(
            path,
            "existing.txt",
            &whitespace_commit.to_string(),
            true,
        )
        .unwrap();

        assert!(!commit_visible.hunks.is_empty());
        assert!(commit_ignored.hunks.is_empty());
    }

    #[test]
    fn test_file_diff_keeps_logic_changes_when_ignoring_whitespace() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        commit_file(&test_repo, "logic base", "existing.txt", "alpha\n  beta\n");
        fs::write(
            test_repo.dir.path().join("existing.txt"),
            "alpha changed\n    beta\n",
        )
        .unwrap();

        let ignored = GitEngine::get_file_diff(path, "existing.txt", false, true).unwrap();

        assert!(!ignored.hunks.is_empty());
        assert_eq!((ignored.additions, ignored.deletions), (1, 1));
        assert!(diff_contents(&ignored).contains("alpha changed"));
    }

    #[cfg(unix)]
    #[test]
    fn test_get_status_includes_typechange() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let tracked_path = test_repo.dir.path().join("existing.txt");

        fs::remove_file(&tracked_path).unwrap();
        std::os::unix::fs::symlink("target.txt", &tracked_path).unwrap();

        let status = GitEngine::get_status(path).expect("Failed to get status");
        assert_eq!(status.unstaged.len(), 1);
        assert_eq!(status.unstaged[0].path, "existing.txt");
        assert_eq!(status.unstaged[0].status, FileStatusKind::TypeChanged);

        let diff = GitEngine::get_file_diff(path, "existing.txt", false, false).unwrap();
        assert_eq!(diff.old_file_mode, Some(0o100644));
        assert_eq!(diff.new_file_mode, Some(0o120000));
        assert!(!diff.hunks.is_empty());
        assert!(diff.additions > 0);
        assert!(diff.deletions > 0);

        GitEngine::stage_file(path, "existing.txt").unwrap();

        let status = GitEngine::get_status(path).expect("Failed to get status after stage");
        assert_eq!(status.staged.len(), 1);
        assert_eq!(status.staged[0].path, "existing.txt");
        assert_eq!(status.staged[0].status, FileStatusKind::TypeChanged);
        assert!(status.unstaged.is_empty());

        let diff = GitEngine::get_file_diff(path, "existing.txt", true, false).unwrap();
        assert_eq!(diff.old_file_mode, Some(0o100644));
        assert_eq!(diff.new_file_mode, Some(0o120000));
        assert!(!diff.hunks.is_empty());
        assert!(diff.additions > 0);
        assert!(diff.deletions > 0);
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
    fn test_undo_last_commit_restores_changes_to_worktree() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let parent_oid = test_repo.repo.head().unwrap().target().unwrap();
        let commit_oid = commit_file(&test_repo, "second commit", "existing.txt", "changed\n");

        let reset_oid = GitEngine::undo_last_commit(path, &commit_oid.to_string()).unwrap();

        assert_eq!(reset_oid, parent_oid.to_string());
        assert_eq!(test_repo.repo.head().unwrap().target(), Some(parent_oid));
        let status = GitEngine::get_status(path).unwrap();
        assert!(status.staged.is_empty());
        assert_eq!(status.unstaged.len(), 1);
        assert_eq!(status.unstaged[0].path, "existing.txt");
        assert_eq!(
            fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap(),
            "changed\n",
        );
    }

    #[test]
    fn test_undo_last_commit_rejects_changed_or_detached_head() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let first = test_repo.repo.head().unwrap().target().unwrap();
        let second = commit_file(&test_repo, "second commit", "existing.txt", "second\n");

        let stale_error = GitEngine::undo_last_commit(path, &first.to_string())
            .unwrap_err()
            .to_string();
        assert!(stale_error.contains("HEAD 已变化"));
        assert_eq!(test_repo.repo.head().unwrap().target(), Some(second));

        test_repo.repo.set_head_detached(second).unwrap();
        let detached_error = GitEngine::undo_last_commit(path, &second.to_string())
            .unwrap_err()
            .to_string();
        assert!(detached_error.contains("游离 HEAD"));
        assert_eq!(test_repo.repo.head().unwrap().target(), Some(second));
    }

    #[test]
    fn test_undo_last_commit_rejects_root_commit() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let root = test_repo.repo.head().unwrap().target().unwrap();

        let error = GitEngine::undo_last_commit(path, &root.to_string())
            .unwrap_err()
            .to_string();

        assert!(error.contains("一个父提交"));
        assert_eq!(test_repo.repo.head().unwrap().target(), Some(root));
    }

    #[test]
    fn test_undo_last_commit_rejects_commit_contained_by_upstream() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let commit_oid = commit_file(&test_repo, "second commit", "existing.txt", "second\n");
        test_repo
            .repo
            .remote("origin", "https://example.com/repo.git")
            .unwrap();
        test_repo
            .repo
            .reference(
                "refs/remotes/origin/main",
                commit_oid,
                true,
                "test upstream",
            )
            .unwrap();
        let head_name = test_repo
            .repo
            .head()
            .unwrap()
            .shorthand()
            .unwrap()
            .to_string();
        test_repo
            .repo
            .find_branch(&head_name, git2::BranchType::Local)
            .unwrap()
            .set_upstream(Some("origin/main"))
            .unwrap();

        let error = GitEngine::undo_last_commit(path, &commit_oid.to_string())
            .unwrap_err()
            .to_string();

        assert!(error.contains("已发布到上游"));
        assert_eq!(test_repo.repo.head().unwrap().target(), Some(commit_oid));
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
    fn test_search_commits_matches_full_metadata_and_reports_truncation() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let body_oid = commit_file(
            &test_repo,
            "Visible subject\n\nHidden body needle",
            "body.txt",
            "body\n",
        );
        commit_file(&test_repo, "shared result one", "one.txt", "one\n");
        commit_file(&test_repo, "shared result two", "two.txt", "two\n");
        commit_file(&test_repo, "shared result three", "three.txt", "three\n");

        let body = GitEngine::search_commits(
            path,
            "BODY NEEDLE",
            20,
            false,
            false,
            LogBranchScope::All,
            true,
        )
        .unwrap();
        assert_eq!(body.commits.len(), 1);
        assert_eq!(body.commits[0].oid, body_oid.to_string());

        let author = GitEngine::search_commits(
            path,
            "test@test.com",
            20,
            false,
            false,
            LogBranchScope::All,
            true,
        )
        .unwrap();
        assert!(!author.commits.is_empty());

        let sha = GitEngine::search_commits(
            path,
            &body_oid.to_string()[..10],
            20,
            false,
            false,
            LogBranchScope::All,
            true,
        )
        .unwrap();
        assert_eq!(sha.commits.len(), 1);
        assert_eq!(sha.commits[0].oid, body_oid.to_string());

        let truncated = GitEngine::search_commits(
            path,
            "shared result",
            2,
            false,
            false,
            LogBranchScope::All,
            true,
        )
        .unwrap();
        assert_eq!(truncated.commits.len(), 2);
        assert!(truncated.has_more);
    }

    #[test]
    fn test_search_commits_respects_remote_branch_filter() {
        let test_repo = TestRepo::new();
        let path = test_repo.path_str();
        let remote_oid = commit_file_to_ref(
            &test_repo,
            "refs/remotes/origin/search-only",
            "remote searchable needle",
            "remote-search.txt",
            "remote\n",
        );

        let with_remote = GitEngine::search_commits(
            path,
            "searchable needle",
            20,
            false,
            false,
            LogBranchScope::All,
            true,
        )
        .unwrap();
        assert!(with_remote
            .commits
            .iter()
            .any(|commit| commit.oid == remote_oid.to_string()));

        let without_remote = GitEngine::search_commits(
            path,
            "searchable needle",
            20,
            false,
            false,
            LogBranchScope::All,
            false,
        )
        .unwrap();
        assert!(without_remote.commits.is_empty());
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
    fn test_drop_unreachable_commit_prunes_descendant_reflog_entries() {
        let test_repo = TestRepo::new();
        let repo = &test_repo.repo;
        let path = test_repo.path_str();
        let base = repo.head().unwrap().peel_to_commit().unwrap().id();

        let a = commit_file(&test_repo, "lost a", "lost-a.txt", "a\n");
        let b = commit_file(&test_repo, "lost b", "lost-b.txt", "b\n");
        let c = commit_file(&test_repo, "lost c", "lost-c.txt", "c\n");

        let base_obj = repo
            .find_object(base, Some(git2::ObjectType::Commit))
            .unwrap();
        repo.reset(&base_obj, git2::ResetType::Hard, None).unwrap();
        drop(base_obj);

        let before =
            GitEngine::get_log(path, 0, 20, true, false, LogBranchScope::All, true).unwrap();
        let before_oids = before
            .commits
            .iter()
            .map(|commit| commit.oid.as_str())
            .collect::<Vec<_>>();
        let a_oid = a.to_string();
        let b_oid = b.to_string();
        let c_oid = c.to_string();
        assert!(before_oids.contains(&a_oid.as_str()));
        assert!(before_oids.contains(&b_oid.as_str()));
        assert!(before_oids.contains(&c_oid.as_str()));

        let preview = GitEngine::preview_drop_unreachable_commit(path, &b_oid).unwrap();
        assert_eq!(preview, 2);

        let removed = GitEngine::drop_unreachable_commit(path, &b_oid).unwrap();
        assert_eq!(removed, 2);
        assert_eq!(
            GitEngine::preview_drop_unreachable_commit(path, &b_oid).unwrap(),
            0
        );

        let after =
            GitEngine::get_log(path, 0, 20, true, false, LogBranchScope::All, true).unwrap();
        let after_oids = after
            .commits
            .iter()
            .map(|commit| commit.oid.as_str())
            .collect::<Vec<_>>();
        assert!(after_oids.contains(&a_oid.as_str()));
        assert!(!after_oids.contains(&b_oid.as_str()));
        assert!(!after_oids.contains(&c_oid.as_str()));
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
