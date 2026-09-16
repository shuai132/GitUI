use git2::{DiffOptions, Repository, Revwalk};
use std::{collections::HashSet, path::Path, sync::Arc};

use crate::git::{
    encoding::{decode_with, detect_file_encoding},
    error::{GitError, GitResult},
    types::*,
};

use super::{
    build_commit_info, commit_message_decoded,
    log_cache::{self, CachedCommit, LogKey, LogSnapshot},
    signature_email, signature_name, summary_from, GitEngine,
};

struct LogWalkContext<'repo> {
    revwalk: Revwalk<'repo>,
    reachable: HashSet<git2::Oid>,
    stash_set: HashSet<git2::Oid>,
    stash_aux_set: HashSet<git2::Oid>,
    reflog_oids: HashSet<git2::Oid>,
    strict_ancestors: HashSet<git2::Oid>,
    include_unreachable: bool,
}

impl GitEngine {
    pub fn get_log(
        path: &str,
        offset: usize,
        limit: usize,
        include_unreachable: bool,
        include_stashes: bool,
        branch_scope: LogBranchScope,
        include_remote_branches: bool,
    ) -> GitResult<LogPage> {
        let repo = Self::open(path)?;
        let snapshot = Self::log_snapshot(
            &repo,
            include_unreachable,
            include_stashes,
            branch_scope,
            include_remote_branches,
        )?;
        let end = offset.saturating_add(limit).min(snapshot.commits.len());
        let mut commits = Vec::with_capacity(end.saturating_sub(offset));
        for entry in snapshot.commits.get(offset..end).unwrap_or_default() {
            let commit = repo.find_commit(entry.oid)?;
            commits.push(Self::cached_commit_info(&commit, entry));
        }
        Ok(LogPage {
            snapshot_id: snapshot.id.clone(),
            total_loaded: offset.saturating_add(commits.len()),
            has_more: end < snapshot.commits.len(),
            commits,
        })
    }

    pub fn clear_log_cache(path: &str) {
        if let Ok(repo) = Self::open(path) {
            let git_dir = repo
                .path()
                .canonicalize()
                .unwrap_or_else(|_| repo.path().to_path_buf());
            log_cache::clear(&git_dir);
        }
    }

    fn log_key(
        repo: &Repository,
        include_unreachable: bool,
        include_stashes: bool,
        branch_scope: LogBranchScope,
        include_remote_branches: bool,
    ) -> GitResult<LogKey> {
        let mut roots = Vec::new();
        let mut reachable_roots = Vec::new();
        if branch_scope == LogBranchScope::All || include_unreachable {
            for reference in repo.references()? {
                let reference = reference?;
                let name = reference.name_bytes();
                let local_or_tag =
                    name.starts_with(b"refs/heads/") || name.starts_with(b"refs/tags/");
                let remote = name.starts_with(b"refs/remotes/");
                if !local_or_tag && (!remote || (!include_remote_branches && !include_unreachable))
                {
                    continue;
                }
                if let Ok(commit) = reference.peel_to_commit() {
                    if include_unreachable {
                        reachable_roots.push(commit.id());
                    }
                    if branch_scope == LogBranchScope::All
                        && (local_or_tag || include_remote_branches)
                    {
                        roots.push(commit.id());
                    }
                }
            }
        }
        if let Ok(head) = repo.head().and_then(|head| head.peel_to_commit()) {
            roots.push(head.id());
            if include_unreachable {
                reachable_roots.push(head.id());
            }
        }
        let mut stashes: Vec<_> = Self::list_stashes(repo)
            .unwrap_or_default()
            .into_iter()
            .map(|(_, _, oid)| oid)
            .collect();
        let mut reflog: Vec<_> = if include_unreachable {
            repo.reflog("HEAD")
                .map(|log| log.iter().map(|entry| entry.id_new()).collect())
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        for oids in [&mut roots, &mut reachable_roots, &mut stashes, &mut reflog] {
            oids.sort_unstable();
            oids.dedup();
        }
        let shallow = match std::fs::read(repo.commondir().join("shallow")) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.into()),
        };
        Ok(LogKey {
            git_dir: repo
                .path()
                .canonicalize()
                .unwrap_or_else(|_| repo.path().to_path_buf()),
            roots,
            reachable_roots,
            stashes,
            reflog,
            shallow,
            branch_scope,
            include_unreachable,
            include_stashes,
            include_remote_branches,
        })
    }

    fn log_snapshot(
        repo: &Repository,
        include_unreachable: bool,
        include_stashes: bool,
        branch_scope: LogBranchScope,
        include_remote_branches: bool,
    ) -> GitResult<Arc<LogSnapshot>> {
        let key = Self::log_key(
            repo,
            include_unreachable,
            include_stashes,
            branch_scope,
            include_remote_branches,
        )?;
        log_cache::load(key.clone(), || {
            let mut context = Self::prepare_log_walk(repo, &key)?;
            let mut commits = Vec::new();
            while let Some(oid) = context.revwalk.next() {
                let oid = oid?;
                if context.stash_aux_set.contains(&oid) {
                    continue;
                }
                let (is_unreachable, is_stash, is_reflog_tip) =
                    Self::log_commit_flags(&context, oid);
                commits.push(CachedCommit {
                    oid,
                    is_unreachable,
                    is_stash,
                    is_reflog_tip,
                });
            }
            Ok(commits)
        })
    }

    fn cached_commit_info(commit: &git2::Commit<'_>, entry: &CachedCommit) -> CommitInfo {
        let parent_oids = if entry.is_stash {
            commit
                .parent_ids()
                .take(1)
                .map(|oid| oid.to_string())
                .collect()
        } else {
            commit.parent_ids().map(|oid| oid.to_string()).collect()
        };
        build_commit_info(
            commit,
            parent_oids,
            entry.is_unreachable,
            entry.is_stash,
            entry.is_reflog_tip,
        )
    }

    fn prepare_log_walk<'repo>(
        repo: &'repo Repository,
        key: &LogKey,
    ) -> GitResult<LogWalkContext<'repo>> {
        let mut reachable = HashSet::new();
        if key.include_unreachable {
            let mut walk = repo.revwalk()?;
            for oid in &key.reachable_roots {
                walk.push(*oid).ok();
            }
            reachable.extend(walk.flatten());
        }
        let stash_set: HashSet<_> = key.stashes.iter().copied().collect();
        let mut stash_aux_set = HashSet::new();
        for oid in &stash_set {
            if let Ok(commit) = repo.find_commit(*oid) {
                stash_aux_set.extend(commit.parent_ids().skip(1));
            }
        }
        let mut revwalk = repo.revwalk()?;
        revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;
        for oid in &key.roots {
            revwalk.push(*oid).ok();
        }
        if key.branch_scope == LogBranchScope::CurrentFirstParent {
            revwalk.simplify_first_parent().ok();
        }
        if key.include_stashes {
            for oid in &key.stashes {
                revwalk.push(*oid).ok();
            }
        }
        let reflog_oids: HashSet<_> = key
            .reflog
            .iter()
            .copied()
            .filter(|oid| !reachable.contains(oid) && !stash_set.contains(oid))
            .collect();
        for oid in key.reflog.iter().filter(|oid| reflog_oids.contains(oid)) {
            revwalk.push(*oid).ok();
        }
        let strict_ancestors = Self::reflog_strict_ancestors(repo, &reflog_oids, &reachable);
        Ok(LogWalkContext {
            revwalk,
            reachable,
            stash_set,
            stash_aux_set,
            reflog_oids,
            strict_ancestors,
            include_unreachable: key.include_unreachable,
        })
    }

    fn reflog_strict_ancestors(
        repo: &Repository,
        roots: &HashSet<git2::Oid>,
        reachable: &HashSet<git2::Oid>,
    ) -> HashSet<git2::Oid> {
        // 从每个入口的父节点开始，避免把入口自身算作自己的严格祖先。
        let mut pending = Vec::new();
        for root in roots {
            if let Ok(commit) = repo.find_commit(*root) {
                pending.extend(commit.parent_ids());
            }
        }

        let mut visited = HashSet::new();
        let mut ancestors = HashSet::new();
        while let Some(oid) = pending.pop() {
            // 可达集合对祖先封闭，其中不可能再出现失联入口。
            if reachable.contains(&oid) || !visited.insert(oid) {
                continue;
            }
            if roots.contains(&oid) {
                ancestors.insert(oid);
            }
            if let Ok(commit) = repo.find_commit(oid) {
                pending.extend(commit.parent_ids());
            }
        }
        ancestors
    }

    fn log_commit_flags(context: &LogWalkContext<'_>, oid: git2::Oid) -> (bool, bool, bool) {
        let is_stash = context.stash_set.contains(&oid);
        let is_unreachable =
            context.include_unreachable && !is_stash && !context.reachable.contains(&oid);
        let is_reflog_tip = is_unreachable
            && context.reflog_oids.contains(&oid)
            && !context.strict_ancestors.contains(&oid);
        (is_unreachable, is_stash, is_reflog_tip)
    }

    pub fn search_commits(
        path: &str,
        query: &str,
        limit: usize,
        include_unreachable: bool,
        include_stashes: bool,
        branch_scope: LogBranchScope,
        include_remote_branches: bool,
    ) -> GitResult<CommitSearchPage> {
        let normalized_query = query.trim().to_lowercase();
        if normalized_query.is_empty() || limit == 0 {
            return Ok(CommitSearchPage {
                commits: Vec::new(),
                has_more: false,
            });
        }

        let repo = Self::open(path)?;
        let snapshot = Self::log_snapshot(
            &repo,
            include_unreachable,
            include_stashes,
            branch_scope,
            include_remote_branches,
        )?;
        let mut matches = Vec::new();
        let mut has_more = false;
        for entry in &snapshot.commits {
            let commit = repo.find_commit(entry.oid)?;
            if !Self::commit_matches_query(&commit, &normalized_query) {
                continue;
            }
            if matches.len() >= limit {
                has_more = true;
                break;
            }
            matches.push(Self::cached_commit_info(&commit, entry));
        }

        Ok(CommitSearchPage {
            commits: matches,
            has_more,
        })
    }

    fn commit_matches_query(commit: &git2::Commit<'_>, query: &str) -> bool {
        let oid = commit.id().to_string();
        if oid.starts_with(query) {
            return true;
        }

        let encoding = commit.message_encoding();
        let author = commit.author();
        commit_message_decoded(commit)
            .to_lowercase()
            .contains(query)
            || signature_name(&author, encoding)
                .to_lowercase()
                .contains(query)
            || signature_email(&author, encoding)
                .to_lowercase()
                .contains(query)
    }

    pub fn get_commit_change_stats(
        path: &str,
        oid_strs: Vec<String>,
    ) -> GitResult<Vec<CommitChangeStats>> {
        let repo = Self::open(path)?;
        let mut out = Vec::with_capacity(oid_strs.len());

        for oid_str in oid_strs {
            let oid = git2::Oid::from_str(&oid_str)
                .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
            let commit = repo.find_commit(oid)?;
            out.push(Self::commit_change_stats(&repo, &commit)?);
        }

        Ok(out)
    }

    fn commit_change_stats(
        repo: &Repository,
        commit: &git2::Commit<'_>,
    ) -> GitResult<CommitChangeStats> {
        let mut stats = CommitChangeStats {
            oid: commit.id().to_string(),
            files_changed: 0,
            additions: 0,
            deletions: 0,
            binary_files: 0,
            large_blob_count: 0,
            large_blob_bytes: 0,
            largest_blob_bytes: 0,
        };

        let commit_tree = commit.tree()?;
        if commit.parent_count() > 0 {
            let parent = commit.parent(0)?;
            let parent_tree = parent.tree()?;
            Self::add_tree_change_stats(repo, Some(&parent_tree), Some(&commit_tree), &mut stats)?;
        } else {
            Self::add_tree_change_stats(repo, None, Some(&commit_tree), &mut stats)?;
        }

        if commit.parent_count() == 3 {
            if let Ok(untracked_commit) = commit.parent(2) {
                if untracked_commit.parent_count() == 0
                    && untracked_commit
                        .message()
                        .unwrap_or("")
                        .starts_with("untracked")
                {
                    if let Ok(untracked_tree) = untracked_commit.tree() {
                        Self::add_tree_change_stats(repo, None, Some(&untracked_tree), &mut stats)?;
                    }
                }
            }
        }

        Ok(stats)
    }

    pub fn get_file_log(
        path: &str,
        file_path: &str,
        offset: usize,
        limit: usize,
    ) -> GitResult<Vec<CommitInfo>> {
        let repo = Self::open(path)?;
        let mut revwalk = repo.revwalk()?;
        revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;
        revwalk
            .push_head()
            .map_err(|e| GitError::OperationFailed(format!("no HEAD: {}", e.message())))?;

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
            results.push(build_commit_info(&commit, parent_oids, false, false, false));
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

    pub fn get_file_blame(path: &str, file_path: &str) -> GitResult<FileBlame> {
        let repo = Self::open(path)?;

        // 读工作区文件内容作为 lines (使用二进制读取 + 编码自适应)
        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::OperationFailed("bare repo not supported".to_string()))?;
        let full_path = workdir.join(file_path);
        let bytes = std::fs::read(&full_path)
            .map_err(|e| GitError::OperationFailed(format!("读取文件失败：{}", e)))?;

        let attr_encoding: Option<String> = repo
            .get_attr(
                Path::new(file_path),
                "working-tree-encoding",
                git2::AttrCheckFlags::default(),
            )
            .ok()
            .flatten()
            .map(|s| s.to_string());

        let enc = detect_file_encoding(&bytes, attr_encoding.as_deref(), None);
        let content = decode_with(enc, &bytes);
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
                        Ok(c) => {
                            let hint = c.message_encoding();
                            let author = c.author();
                            (
                                orig_oid.to_string(),
                                orig_oid.to_string()[..7].to_string(),
                                signature_name(&author, hint),
                                signature_email(&author, hint),
                                c.time().seconds(),
                                summary_from(&commit_message_decoded(&c)),
                            )
                        }
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
        let entry = tree.get_path(Path::new(file_path)).map_err(|_| {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_utils::TestRepo;

    fn commit(repo: &Repository, message: &str, parents: &[git2::Oid]) -> git2::Oid {
        let tree = repo.head().unwrap().peel_to_tree().unwrap();
        let parents: Vec<_> = parents
            .iter()
            .map(|oid| repo.find_commit(*oid).unwrap())
            .collect();
        let parent_refs: Vec<_> = parents.iter().collect();
        let signature = repo.signature().unwrap();
        repo.commit(None, &signature, &signature, message, &tree, &parent_refs)
            .unwrap()
    }

    fn add_reflog_roots(repo: &Repository, roots: &[git2::Oid]) {
        let signature = repo.signature().unwrap();
        let mut reflog = repo.reflog("HEAD").unwrap();
        for oid in roots {
            reflog
                .append(*oid, &signature, Some("lost commit"))
                .unwrap();
        }
        reflog.write().unwrap();
    }

    #[test]
    fn snapshot_inputs_track_refs_reflog_stash_and_shallow_boundaries() {
        let fixture = TestRepo::new();
        let repo = &fixture.repo;
        let read_key = || GitEngine::log_key(repo, true, true, LogBranchScope::All, true).unwrap();
        let original = read_key();
        std::fs::write(
            fixture.dir.path().join("worktree.txt"),
            "not a history change",
        )
        .unwrap();
        assert_eq!(original, read_key());
        let base = repo.head().unwrap().target().unwrap();
        let lost = commit(repo, "lost", &[base]);
        add_reflog_roots(repo, &[lost]);
        let with_reflog = read_key();
        assert_ne!(original, with_reflog);
        repo.reference("refs/heads/recovered", lost, false, "recover")
            .unwrap();
        let with_ref = read_key();
        assert_ne!(with_reflog, with_ref);
        repo.find_reference("refs/heads/recovered")
            .unwrap()
            .delete()
            .unwrap();
        assert_eq!(with_reflog, read_key());
        let mut stash_log = repo.reflog("refs/stash").unwrap();
        stash_log
            .append(lost, &repo.signature().unwrap(), Some("stash"))
            .unwrap();
        stash_log.write().unwrap();
        let with_stash = read_key();
        assert_ne!(with_reflog, with_stash);
        std::fs::write(repo.commondir().join("shallow"), format!("{base}\n")).unwrap();
        assert_ne!(with_stash, read_key());
    }

    #[test]
    fn snapshot_pages_match_a_single_read_without_duplicates() {
        let fixture = TestRepo::new();
        let repo = &fixture.repo;
        let base = repo.head().unwrap().target().unwrap();
        let mut parent = base;
        for index in 0..17 {
            parent = commit(repo, &format!("commit {index}"), &[parent]);
        }
        repo.reference("refs/heads/long", parent, false, "long history")
            .unwrap();
        let page = |offset, limit| {
            GitEngine::get_log(
                fixture.path_str(),
                offset,
                limit,
                true,
                true,
                LogBranchScope::All,
                true,
            )
            .unwrap()
        };
        let all = page(0, 100);
        let mut paged = Vec::new();
        let mut offset = 0;
        loop {
            let next = page(offset, 5);
            offset += next.commits.len();
            assert_eq!(next.total_loaded, offset);
            paged.extend(next.commits);
            if !next.has_more {
                break;
            }
        }
        assert_eq!(
            paged.iter().map(|entry| &entry.oid).collect::<Vec<_>>(),
            all.commits
                .iter()
                .map(|entry| &entry.oid)
                .collect::<Vec<_>>()
        );
        assert_eq!(paged.len(), 18);
        assert!(page(100, 5).commits.is_empty());
        assert!(page(0, 0).has_more);
    }

    #[test]
    fn reflog_tips_preserve_merge_and_independent_lost_histories() {
        let fixture = TestRepo::new();
        let repo = &fixture.repo;
        let base = repo.head().unwrap().target().unwrap();
        let a = commit(repo, "a", &[base]);
        let b = commit(repo, "b", &[a]);
        let c = commit(repo, "c", &[a]);
        let merge = commit(repo, "merge", &[b, c]);
        let independent = commit(repo, "independent", &[base]);
        add_reflog_roots(repo, &[a, b, c, merge, independent]);

        let page = GitEngine::get_log(
            fixture.path_str(),
            0,
            20,
            true,
            false,
            LogBranchScope::All,
            true,
        )
        .unwrap();
        for entry in page.commits {
            let oid = git2::Oid::from_str(&entry.oid).unwrap();
            assert_eq!(entry.is_unreachable, oid != base);
            assert_eq!(entry.is_reflog_tip, oid == merge || oid == independent);
            assert!(!entry.is_stash);
        }
        let search = GitEngine::search_commits(
            fixture.path_str(),
            "merge",
            20,
            true,
            false,
            LogBranchScope::All,
            true,
        )
        .unwrap();
        assert_eq!(search.commits.len(), 1);
        assert!(search.commits[0].is_reflog_tip);
    }

    #[test]
    fn reflog_ancestors_cross_unlisted_commits_and_stop_at_reachable_history() {
        let fixture = TestRepo::new();
        let repo = &fixture.repo;
        let base = repo.head().unwrap().target().unwrap();
        let a = commit(repo, "a", &[base]);
        let intermediate = commit(repo, "not in reflog", &[a]);
        let tip = commit(repo, "tip", &[intermediate]);
        let roots = HashSet::from([a, tip]);

        assert_eq!(
            GitEngine::reflog_strict_ancestors(repo, &roots, &HashSet::from([base])),
            HashSet::from([a])
        );
        assert!(GitEngine::reflog_strict_ancestors(
            repo,
            &HashSet::from([tip]),
            &HashSet::from([base, a, intermediate])
        )
        .is_empty());
        assert!(
            GitEngine::reflog_strict_ancestors(repo, &HashSet::new(), &HashSet::from([base]))
                .is_empty()
        );
    }
}
