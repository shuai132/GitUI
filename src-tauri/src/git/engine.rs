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

        let staged = GitEngine::get_file_diff(path, "existing.txt", true).unwrap();
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

        let staged = GitEngine::get_file_diff(path, "existing.txt", true).unwrap();
        let staged_content = diff_contents(&staged);
        assert!(staged_content.contains("inserted\n"));
        assert!(!staged_content.contains("LINE16\n"));

        let unstaged = GitEngine::get_file_diff(path, "existing.txt", false).unwrap();
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

        let staged = GitEngine::get_file_diff(path, "existing.txt", true).unwrap();
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

        let staged = GitEngine::get_file_diff(path, "existing.txt", true).unwrap();
        assert!(staged.hunks.is_empty());

        let worktree = fs::read_to_string(test_repo.dir.path().join("existing.txt")).unwrap();
        assert!(worktree.contains("inserted\n"));
        assert!(worktree.contains("LINE22\n"));
        assert!(worktree.contains("line16\n"));
        assert!(!worktree.contains("LINE16\n"));
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
