use git2::{DiffOptions, Repository, Revwalk};
use std::{collections::HashSet, path::Path};

use crate::git::{
    encoding::{decode_with, detect_file_encoding},
    error::{GitError, GitResult},
    types::*,
};

use super::{
    build_commit_info, commit_message_decoded, signature_email, signature_name, summary_from,
    GitEngine,
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
        let mut context = Self::prepare_log_walk(
            &repo,
            include_unreachable,
            include_stashes,
            branch_scope,
            include_remote_branches,
        )?;

        let mut commits = Vec::new();
        let mut idx = 0;
        let mut has_more = false;

        while let Some(oid_result) = context.revwalk.next() {
            let oid = oid_result?;
            // 跳过 stash 的辅助 commit（index / untracked 快照），它们不作为独立行
            if context.stash_aux_set.contains(&oid) {
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
            let (is_unreachable, is_stash, is_reflog_tip) = Self::log_commit_flags(&context, oid);

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

            commits.push(build_commit_info(
                &commit,
                parent_oids,
                is_unreachable,
                is_stash,
                is_reflog_tip,
            ));
            idx += 1;
        }

        let total_loaded = offset + commits.len();
        Ok(LogPage {
            commits,
            has_more,
            total_loaded,
        })
    }

    fn prepare_log_walk<'repo>(
        repo: &'repo Repository,
        include_unreachable: bool,
        include_stashes: bool,
        branch_scope: LogBranchScope,
        include_remote_branches: bool,
    ) -> GitResult<LogWalkContext<'repo>> {
        // 仅在显示丢失引用时收集所有 ref 可达 oid。普通日志和搜索路径
        // 不需要判断 unreachable，跳过这轮 revwalk 以保持首屏轻量。
        let mut reachable = HashSet::new();
        if include_unreachable {
            let mut walk = repo.revwalk()?;
            walk.push_glob("refs/heads/*").ok();
            walk.push_glob("refs/remotes/*").ok();
            walk.push_glob("refs/tags/*").ok();
            walk.push_head().ok();
            for oid in walk.flatten() {
                reachable.insert(oid);
            }
        }

        // Stash 的 index / untracked parent 是存储细节，不作为独立提交行。
        let mut stash_set = HashSet::new();
        if let Ok(entries) = Self::list_stashes(repo) {
            for (_, _, oid) in entries {
                stash_set.insert(oid);
            }
        }
        let mut stash_aux_set = HashSet::new();
        for stash_oid in stash_set.iter().copied() {
            if let Ok(commit) = repo.find_commit(stash_oid) {
                for (index, parent) in commit.parent_ids().enumerate() {
                    if index > 0 {
                        stash_aux_set.insert(parent);
                    }
                }
            }
        }

        let mut revwalk = repo.revwalk()?;
        revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;
        match branch_scope {
            LogBranchScope::All => {
                revwalk.push_glob("refs/heads/*").ok();
                if include_remote_branches {
                    revwalk.push_glob("refs/remotes/*").ok();
                }
                revwalk.push_glob("refs/tags/*").ok();
                revwalk.push_head().ok();
            }
            LogBranchScope::CurrentFirstParent => {
                revwalk.push_head().ok();
                revwalk.simplify_first_parent().ok();
            }
        }
        if include_stashes {
            for oid in &stash_set {
                revwalk.push(*oid).ok();
            }
        }

        let mut reflog_oids = HashSet::new();
        let mut strict_ancestors = HashSet::new();
        if include_unreachable {
            if let Ok(reflog) = repo.reflog("HEAD") {
                for entry in reflog.iter() {
                    let oid = entry.id_new();
                    if !reachable.contains(&oid) && !stash_set.contains(&oid) {
                        revwalk.push(oid).ok();
                        reflog_oids.insert(oid);
                    }
                }
            }

            // reflog oid 若是另一 reflog oid 的严格祖先，就不是可直接移除的 tip。
            for root in &reflog_oids {
                if let Ok(mut ancestors) = repo.revwalk() {
                    if ancestors.push(*root).is_err() {
                        continue;
                    }
                    for oid in ancestors.skip(1).flatten() {
                        strict_ancestors.insert(oid);
                    }
                }
            }
        }

        Ok(LogWalkContext {
            revwalk,
            reachable,
            stash_set,
            stash_aux_set,
            reflog_oids,
            strict_ancestors,
            include_unreachable,
        })
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
        let mut context = Self::prepare_log_walk(
            &repo,
            include_unreachable,
            include_stashes,
            branch_scope,
            include_remote_branches,
        )?;
        let mut matches = Vec::new();
        let mut has_more = false;

        while let Some(oid_result) = context.revwalk.next() {
            let oid = oid_result?;
            if context.stash_aux_set.contains(&oid) {
                continue;
            }
            let commit = repo.find_commit(oid)?;
            if !Self::commit_matches_query(&commit, &normalized_query) {
                continue;
            }
            if matches.len() >= limit {
                has_more = true;
                break;
            }

            let (is_unreachable, is_stash, is_reflog_tip) = Self::log_commit_flags(&context, oid);
            let parent_oids = if is_stash {
                commit
                    .parent_ids()
                    .next()
                    .map(|parent| vec![parent.to_string()])
                    .unwrap_or_default()
            } else {
                commit
                    .parent_ids()
                    .map(|parent| parent.to_string())
                    .collect()
            };
            matches.push(build_commit_info(
                &commit,
                parent_oids,
                is_unreachable,
                is_stash,
                is_reflog_tip,
            ));
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

    /// 返回指定提交里 file_path 的 diff（仅该文件，不加载整个 CommitDetail）。

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
