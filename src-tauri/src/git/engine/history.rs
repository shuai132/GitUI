use git2::{DiffOptions, Repository};
use std::path::Path;

use crate::git::{
    encoding::{decode_with, detect_file_encoding},
    error::{GitError, GitResult},
    types::*,
};

use super::{
    build_commit_info, commit_message_decoded, signature_email, signature_name, summary_from,
    GitEngine,
};

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
        use std::collections::HashSet;

        let repo = Self::open(path)?;

        // ── Step A: 仅在显示丢失引用时收集所有 ref 可达 oid。
        // 普通日志路径不需要判断 unreachable，跳过这轮 revwalk 以保持首屏轻量。
        let mut reachable: HashSet<git2::Oid> = HashSet::new();
        if include_unreachable {
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
            let is_unreachable = include_unreachable && !is_stash && !reachable.contains(&oid);
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
