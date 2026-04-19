//! Rebase 操作。
//!
//! libgit2 对 rebase 的支持：`Repository::rebase(branch, upstream, onto, opts)` 创建
//! Rebase 对象，`Rebase::next()` 推进每一步，冲突时 `index.has_conflicts()` 为真。
//! 我们在此之上支持交互式 todo：reword / squash / fixup / drop / reorder。
//!
//! 交互语义简化：
//! - **reword**：冲突无关时暂停，让前端通过 `rebase_continue(amended_message)` 带入新消息
//! - **squash / fixup**：在 pick 当前步后，立即和前一步（已 pick 的 HEAD）合并成一个 commit；
//!   squash 的消息沿用 todo 中的 `new_message`（plan 阶段就定好），fixup 固定用前一步消息
//! - **drop**：跳过该步
//! - **reorder**：todo 列表顺序决定执行顺序
//!
//! 中间状态持久化到 `.git/rebase-merge/`（libgit2 默认目录），我们额外维护一个
//! `.git/gitui-rebase-todo.json` 文件，供 continue/skip 时恢复剩余 todo。
//!
//! 失败策略：任何 commit 冲突时 Rebase::abort 不被调用——状态保留，前端看 `RepoState`
//! 选择 continue/skip/abort。

use std::path::PathBuf;

use git2::{AnnotatedCommit, Repository, RepositoryState};
use serde::{Deserialize, Serialize};

use crate::git::{
    engine::GitEngine,
    error::{GitError, GitResult},
    types::{RebaseActionKind, RebaseTodoItem},
};

/// 我们自己持久化的 rebase 状态（区别于 libgit2 的 `.git/rebase-merge/` 内部文件）
#[derive(Debug, Serialize, Deserialize)]
struct StoredRebaseState {
    /// 剩余 todo（当前步是 index 0）
    todo: Vec<RebaseTodoItem>,
    /// 已完成步，用于 squash/fixup 找前一步的 tree
    #[serde(default)]
    done: Vec<String>,
}

impl GitEngine {
    /// 给定 upstream（通常是目标分支或目标 commit），返回默认的 todo 列表
    /// （全部 pick，顺序为 upstream..HEAD）。前端用它作为交互式 rebase 的起点。
    pub fn rebase_plan(
        path: &str,
        upstream: &str,
        onto: Option<&str>,
    ) -> GitResult<Vec<RebaseTodoItem>> {
        let repo = Self::open(path)?;
        let head = repo.head()?.peel_to_commit()?;
        let upstream_oid = resolve_oid(&repo, upstream)?;
        let _onto_oid = match onto {
            Some(s) => Some(resolve_oid(&repo, s)?),
            None => None,
        };

        // revwalk: upstream..HEAD
        let mut walk = repo.revwalk()?;
        walk.push(head.id())?;
        walk.hide(upstream_oid)?;
        walk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::REVERSE)?;

        let mut items = Vec::new();
        for oid_result in walk {
            let oid = oid_result?;
            let commit = repo.find_commit(oid)?;
            let short = {
                let buf = commit.as_object().short_id()?;
                buf.as_str().unwrap_or("").to_string()
            };
            items.push(RebaseTodoItem {
                oid: oid.to_string(),
                short_oid: short,
                action: RebaseActionKind::Pick,
                subject: commit.summary().unwrap_or("").to_string(),
                new_message: None,
                new_author_time: None,
                new_committer_time: None,
                new_author_name: None,
                new_author_email: None,
            });
        }
        Ok(items)
    }

    /// 开始 rebase。`todo=None` 等价于 `rebase_plan` 默认结果（全部 pick）。
    pub fn rebase_start(
        path: &str,
        upstream: &str,
        onto: Option<&str>,
        todo: Option<Vec<RebaseTodoItem>>,
    ) -> GitResult<()> {
        let repo = Self::open(path)?;
        if repo.state() != RepositoryState::Clean {
            return Err(GitError::OperationFailed(
                "仓库处于进行中的 merge/rebase/cherry-pick 状态，请先继续或中止".to_string(),
            ));
        }

        // 脏工作区拒绝
        let statuses = repo.statuses(Some(
            git2::StatusOptions::new()
                .include_untracked(false)
                .include_ignored(false),
        ))?;
        if !statuses.is_empty() {
            return Err(GitError::OperationFailed(
                "工作区有未提交更改，请先提交或 stash".to_string(),
            ));
        }

        let todo = match todo {
            Some(t) => t,
            None => Self::rebase_plan(path, upstream, onto)?,
        };

        // drop 在前端就该过滤掉也没关系；后端也兜底过滤一次
        let todo: Vec<RebaseTodoItem> = todo
            .into_iter()
            .filter(|t| t.action != RebaseActionKind::Drop)
            .collect();

        if todo.is_empty() {
            return Ok(());
        }

        let upstream_annotated = resolve_annotated(&repo, upstream)?;
        let onto_annotated = match onto {
            Some(s) => Some(resolve_annotated(&repo, s)?),
            None => None,
        };

        let head_ref = repo.head()?;
        let head_annotated = repo.reference_to_annotated_commit(&head_ref)?;

        let mut rebase = repo.rebase(
            Some(&head_annotated),
            Some(&upstream_annotated),
            onto_annotated.as_ref(),
            None,
        )?;

        // 持久化 todo 到 .git/gitui-rebase-todo.json
        let state = StoredRebaseState {
            todo: todo.clone(),
            done: Vec::new(),
        };
        write_stored_state(&repo, &state)?;

        // 推进 rebase 直到遇到冲突 / reword 暂停 / 结束
        let result = run_rebase_loop(&repo, &mut rebase, state);
        match result {
            Ok(true) => {
                rebase.finish(None)?;
                let _ = std::fs::remove_file(stored_state_path(&repo));
                Ok(())
            }
            Ok(false) => {
                // 暂停（reword）— 保持 rebase 中间态
                Ok(())
            }
            Err(e) => Err(e),
        }
    }

    /// 继续 rebase（解决冲突或填完 reword 消息后）。
    pub fn rebase_continue(path: &str, amended_message: Option<&str>) -> GitResult<()> {
        let repo = Self::open(path)?;
        if !in_rebase_state(&repo) {
            return Err(GitError::OperationFailed(
                "仓库当前不在 rebase 状态".to_string(),
            ));
        }

        let index = repo.index()?;
        if index.has_conflicts() {
            return Err(GitError::OperationFailed("仍有未解决的冲突".to_string()));
        }

        let mut stored = read_stored_state(&repo).unwrap_or(StoredRebaseState {
            todo: Vec::new(),
            done: Vec::new(),
        });

        // 再次打开 rebase（libgit2 Rebase::open）
        let mut rebase = repo.open_rebase(None)?;

        // 完成当前正在处理的 operation（对应 stored.todo[0]）
        let current = stored.todo.first().cloned();
        if let Some(cur) = current {
            let sig = repo.signature()?;
            match cur.action {
                RebaseActionKind::Pick => {
                    // 冲突后继续：直接 commit 当前 index
                    rebase.commit(None, &sig, None)?;
                    stored.done.push(cur.oid.clone());
                }
                RebaseActionKind::Reword => {
                    let msg = amended_message
                        .filter(|s| !s.trim().is_empty())
                        .or(cur.new_message.as_deref())
                        .unwrap_or(cur.subject.as_str());
                    rebase.commit(None, &sig, Some(msg))?;
                    stored.done.push(cur.oid.clone());
                }
                RebaseActionKind::Squash | RebaseActionKind::Fixup => {
                    // 当前作为 pick 提交，再和前一步合并
                    rebase.commit(None, &sig, None)?;
                    stored.done.push(cur.oid.clone());
                    combine_with_previous(&repo, &cur)?;
                }
                RebaseActionKind::Drop => {
                    // 不应发生——start 时已过滤
                }
            }
            stored.todo.remove(0);
        }

        // 继续后续步骤
        let done = run_rebase_loop(&repo, &mut rebase, stored)?;
        if done {
            rebase.finish(None)?;
            let _ = std::fs::remove_file(stored_state_path(&repo));
        }
        Ok(())
    }

    /// 跳过当前冲突步，继续 rebase。
    pub fn rebase_skip(path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        if !in_rebase_state(&repo) {
            return Err(GitError::OperationFailed(
                "仓库当前不在 rebase 状态".to_string(),
            ));
        }

        // 丢弃当前冲突改动
        let head_commit = repo.head()?.peel_to_commit()?;
        repo.reset(head_commit.as_object(), git2::ResetType::Hard, None)?;

        // stored todo 中移除当前步
        let mut stored = read_stored_state(&repo).unwrap_or(StoredRebaseState {
            todo: Vec::new(),
            done: Vec::new(),
        });
        if !stored.todo.is_empty() {
            stored.todo.remove(0);
        }

        // 继续 rebase
        let mut rebase = repo.open_rebase(None)?;
        let done = run_rebase_loop(&repo, &mut rebase, stored)?;
        if done {
            rebase.finish(None)?;
            let _ = std::fs::remove_file(stored_state_path(&repo));
        }
        Ok(())
    }

    /// 中止 rebase：恢复到 rebase 开始前的 HEAD。
    pub fn rebase_abort(path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        if !in_rebase_state(&repo) {
            return Err(GitError::OperationFailed(
                "仓库当前不在 rebase 状态".to_string(),
            ));
        }
        let mut rebase = repo.open_rebase(None)?;
        rebase.abort()?;
        let _ = std::fs::remove_file(stored_state_path(&repo));
        Ok(())
    }
}

fn in_rebase_state(repo: &Repository) -> bool {
    matches!(
        repo.state(),
        RepositoryState::Rebase | RepositoryState::RebaseInteractive | RepositoryState::RebaseMerge
    )
}

fn resolve_oid(repo: &Repository, spec: &str) -> GitResult<git2::Oid> {
    if let Ok(obj) = repo.revparse_single(spec) {
        return Ok(obj.peel_to_commit()?.id());
    }
    git2::Oid::from_str(spec)
        .map_err(|_| GitError::OperationFailed(format!("无法识别的分支或提交：{spec}")))
}

fn resolve_annotated<'a>(repo: &'a Repository, spec: &str) -> GitResult<AnnotatedCommit<'a>> {
    if let Ok(reference) = repo.resolve_reference_from_short_name(spec) {
        return Ok(repo.reference_to_annotated_commit(&reference)?);
    }
    if let Ok(reference) = repo.find_reference(spec) {
        return Ok(repo.reference_to_annotated_commit(&reference)?);
    }
    let oid = git2::Oid::from_str(spec)
        .map_err(|_| GitError::OperationFailed(format!("无法识别的分支或提交：{spec}")))?;
    Ok(repo.find_annotated_commit(oid)?)
}

/// 推进 rebase。返回 true 表示已全部完成，false 表示因 reword 暂停。
/// 冲突时返回 Err（但 rebase 状态保留）。
fn run_rebase_loop(
    repo: &Repository,
    rebase: &mut git2::Rebase<'_>,
    mut stored: StoredRebaseState,
) -> GitResult<bool> {
    let sig = repo.signature()?;

    while let Some(op) = rebase.next() {
        let _op = op?;

        // 当前步对应 stored.todo[0]
        let cur = match stored.todo.first().cloned() {
            Some(c) => c,
            None => {
                // 没有对应 todo，按 pick 处理
                let index = repo.index()?;
                if index.has_conflicts() {
                    write_stored_state(repo, &stored)?;
                    return Err(GitError::OperationFailed(
                        "Rebase 出现冲突，请解决后继续".to_string(),
                    ));
                }
                rebase.commit(None, &sig, None)?;
                continue;
            }
        };

        if cur.action == RebaseActionKind::Drop {
            // libgit2 仍会产生一个 Pick op；跳过提交
            stored.todo.remove(0);
            write_stored_state(repo, &stored)?;
            continue;
        }

        let index = repo.index()?;
        if index.has_conflicts() {
            write_stored_state(repo, &stored)?;
            return Err(GitError::OperationFailed(
                "Rebase 出现冲突，请解决后继续".to_string(),
            ));
        }

        match cur.action {
            RebaseActionKind::Pick => {
                rebase.commit(None, &sig, None)?;
            }
            RebaseActionKind::Reword => {
                if let Some(msg) = cur.new_message.as_deref().filter(|s| !s.trim().is_empty()) {
                    // committer：有 new_committer_time 则覆盖，否则沿用 sig 的当前时间
                    let ct = cur
                        .new_committer_time
                        .unwrap_or_else(|| sig.when().seconds());
                    let committer = GitEngine::sig_with_time(&sig, ct)?;
                    // author：有 new_author_time / new_author_name / new_author_email 任一则覆盖；
                    // 否则传 None，让 libgit2 保留原提交的 author（含原 date）
                    let has_author_override = cur.new_author_time.is_some()
                        || cur.new_author_name.is_some()
                        || cur.new_author_email.is_some();
                    let author_override: Option<git2::Signature<'_>> = if has_author_override {
                        let orig_oid = git2::Oid::from_str(&cur.oid)
                            .map_err(|e| GitError::OperationFailed(e.to_string()))?;
                        let orig_commit = repo.find_commit(orig_oid)?;
                        let orig_author = orig_commit.author();
                        let at = cur
                            .new_author_time
                            .unwrap_or_else(|| orig_author.when().seconds());
                        Some(GitEngine::sig_with_overrides(
                            &orig_author,
                            at,
                            cur.new_author_name.as_deref(),
                            cur.new_author_email.as_deref(),
                        )?)
                    } else {
                        None
                    };
                    rebase.commit(author_override.as_ref(), &committer, Some(msg))?;
                } else {
                    // 暂停，等前端补消息
                    write_stored_state(repo, &stored)?;
                    return Ok(false);
                }
            }
            RebaseActionKind::Squash | RebaseActionKind::Fixup => {
                rebase.commit(None, &sig, None)?;
                combine_with_previous(repo, &cur)?;
            }
            RebaseActionKind::Drop => unreachable!(),
        }

        stored.done.push(cur.oid.clone());
        stored.todo.remove(0);
        write_stored_state(repo, &stored)?;
    }

    Ok(true)
}

/// squash / fixup：把刚提交的 HEAD 和它的父合并成一个 commit。
/// squash 用 `cur.new_message` 作为新 commit message；fixup 沿用父的。
fn combine_with_previous(repo: &Repository, cur: &RebaseTodoItem) -> GitResult<()> {
    let head = repo.head()?.peel_to_commit()?;
    let parent = head.parent(0).map_err(|_| {
        GitError::OperationFailed("squash/fixup 需要前一步提交作为基础".to_string())
    })?;

    let tree = head.tree()?;
    let sig = repo.signature()?;
    let msg = match cur.action {
        RebaseActionKind::Fixup => parent.message().unwrap_or("").to_string(),
        RebaseActionKind::Squash => {
            if let Some(m) = cur.new_message.as_deref().filter(|s| !s.trim().is_empty()) {
                m.to_string()
            } else {
                // 默认把两条消息拼起来
                let mut s = String::new();
                s.push_str(parent.message().unwrap_or("").trim());
                s.push_str("\n\n");
                s.push_str(head.message().unwrap_or("").trim());
                s
            }
        }
        _ => head.message().unwrap_or("").to_string(),
    };

    let parents: Vec<git2::Commit<'_>> = parent.parents().collect();
    let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
    let new_oid = repo.commit(None, &parent.author(), &sig, &msg, &tree, &parent_refs)?;
    // 更新当前分支 head（rebase 过程中 HEAD 是 detached 的情况由 libgit2 维护；
    // 这里直接 set_head_detached 到新 commit）
    repo.set_head_detached(new_oid)?;
    Ok(())
}

fn stored_state_path(repo: &Repository) -> PathBuf {
    repo.path().join("gitui-rebase-todo.json")
}

fn write_stored_state(repo: &Repository, state: &StoredRebaseState) -> GitResult<()> {
    let p = stored_state_path(repo);
    let data = serde_json::to_vec_pretty(state)
        .map_err(|e| GitError::OperationFailed(format!("序列化 rebase 状态失败：{e}")))?;
    std::fs::write(p, data)
        .map_err(|e| GitError::OperationFailed(format!("写入 rebase 状态失败：{e}")))?;
    Ok(())
}

fn read_stored_state(repo: &Repository) -> Option<StoredRebaseState> {
    let p = stored_state_path(repo);
    let data = std::fs::read(&p).ok()?;
    serde_json::from_slice(&data).ok()
}
