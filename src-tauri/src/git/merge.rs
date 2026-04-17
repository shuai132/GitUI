//! Merge 操作：基于 libgit2 实现 fast-forward / non-ff / squash 三种策略，
//! 冲突时保留中间状态，由前端走 continue / abort 流程。
//!
//! 所有入口都经由 `GitEngine` 的 `impl` 块挂出来，和 `engine.rs` 中其它方法共用
//! `GitEngine::open`、`signature` 等工具。

use git2::{Repository, RepositoryState};

use crate::git::{
    engine::GitEngine,
    error::{GitError, GitResult},
    types::MergeStrategy,
};

impl GitEngine {
    /// 把 `source_branch`（本地 / 远程分支名，也可是 commit oid）合并到当前分支。
    ///
    /// - `strategy = Auto`：能 FF 就 FF，否则创建 merge commit
    /// - `strategy = FastForward`：只允许 FF，不能时返回错误
    /// - `strategy = NoFastForward`：强制创建 merge commit
    /// - `strategy = Squash`：不创建 merge commit，只把改动落在 index，等用户手动 commit
    ///
    /// 冲突时保留 `.git/MERGE_HEAD` / `.git/MERGE_MSG`，返回 OperationFailed。
    pub fn merge_branch(
        path: &str,
        source_branch: &str,
        strategy: MergeStrategy,
        message: Option<&str>,
    ) -> GitResult<()> {
        let repo = Self::open(path)?;

        if repo.state() != RepositoryState::Clean {
            return Err(GitError::OperationFailed(
                "仓库处于进行中的 merge/rebase/cherry-pick 状态，请先继续或中止当前操作".to_string(),
            ));
        }

        let source_commit = resolve_annotated(&repo, source_branch)?;
        let (analysis, _pref) = repo.merge_analysis(&[&source_commit])?;

        if analysis.is_up_to_date() {
            return Ok(());
        }

        // Fast-forward 分支
        if analysis.is_fast_forward() && strategy != MergeStrategy::NoFastForward {
            if strategy == MergeStrategy::Squash {
                return Err(GitError::OperationFailed(
                    "Squash 合并要求存在分歧的提交；当前可以直接 fast-forward".to_string(),
                ));
            }
            return fast_forward(&repo, &source_commit);
        }

        if strategy == MergeStrategy::FastForward {
            return Err(GitError::OperationFailed(
                "无法 fast-forward：两个分支已经分叉".to_string(),
            ));
        }

        // Non-FF 或 Squash：执行 merge 将改动写入 index/工作区
        let mut merge_opts = git2::MergeOptions::new();
        let mut checkout_opts = git2::build::CheckoutBuilder::new();
        checkout_opts.allow_conflicts(true);
        repo.merge(
            &[&source_commit],
            Some(&mut merge_opts),
            Some(&mut checkout_opts),
        )?;

        let mut index = repo.index()?;
        if index.has_conflicts() {
            // 留下 MERGE_HEAD / MERGE_MSG 让前端继续流程
            return Err(GitError::OperationFailed(
                "Merge 出现冲突，请解决后继续".to_string(),
            ));
        }

        if strategy == MergeStrategy::Squash {
            // 清 MERGE_HEAD，保留 MERGE_MSG 供后续 create_commit 使用。
            // libgit2 的 cleanup_state 会一起清 MERGE_MSG，这里我们手动只删 MERGE_HEAD
            // 以保留模板消息。
            let git_dir = repo.path().to_path_buf();
            let _ = std::fs::remove_file(git_dir.join("MERGE_HEAD"));
            let _ = std::fs::remove_file(git_dir.join("MERGE_MODE"));
            return Ok(());
        }

        // 非 FF：创建 merge commit（二父）
        let sig = repo.signature()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let head_commit = repo.head()?.peel_to_commit()?;
        let source = repo.find_commit(source_commit.id())?;

        let commit_msg = match message {
            Some(m) if !m.trim().is_empty() => m.to_string(),
            _ => {
                // 优先读已有 MERGE_MSG；否则用默认
                let default = default_merge_message(&repo, source_branch, &source);
                read_merge_msg(&repo).unwrap_or(default)
            }
        };

        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            &commit_msg,
            &tree,
            &[&head_commit, &source],
        )?;
        repo.cleanup_state()?;
        Ok(())
    }

    /// 冲突解决后继续 merge：读 MERGE_HEAD，创建 merge commit。
    pub fn merge_continue(path: &str, message: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        if repo.state() != RepositoryState::Merge {
            return Err(GitError::OperationFailed(
                "仓库当前不在 merge 状态".to_string(),
            ));
        }

        let mut index = repo.index()?;
        if index.has_conflicts() {
            return Err(GitError::OperationFailed(
                "仍有未解决的冲突".to_string(),
            ));
        }

        let merge_head_oid = {
            let content = std::fs::read_to_string(repo.path().join("MERGE_HEAD"))
                .map_err(|e| GitError::OperationFailed(format!("读取 MERGE_HEAD 失败：{e}")))?;
            let first = content.lines().next().unwrap_or("").trim().to_string();
            git2::Oid::from_str(&first)
                .map_err(|e| GitError::OperationFailed(e.message().to_string()))?
        };
        let source = repo.find_commit(merge_head_oid)?;
        let head_commit = repo.head()?.peel_to_commit()?;

        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let sig = repo.signature()?;

        let msg = if message.trim().is_empty() {
            read_merge_msg(&repo)
                .unwrap_or_else(|| format!("Merge commit {}", source.id()))
        } else {
            message.to_string()
        };

        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            &msg,
            &tree,
            &[&head_commit, &source],
        )?;
        repo.cleanup_state()?;
        Ok(())
    }

    /// 中止 merge：放弃冲突的更改并恢复 HEAD。
    pub fn merge_abort(path: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        if repo.state() != RepositoryState::Merge {
            return Err(GitError::OperationFailed(
                "仓库当前不在 merge 状态".to_string(),
            ));
        }

        // 先 reset 到 HEAD 丢弃工作区冲突改动
        let head_commit = repo.head()?.peel_to_commit()?;
        repo.reset(head_commit.as_object(), git2::ResetType::Hard, None)?;
        repo.cleanup_state()?;
        Ok(())
    }
}

fn resolve_annotated<'a>(
    repo: &'a Repository,
    spec: &str,
) -> GitResult<git2::AnnotatedCommit<'a>> {
    // 先尝试当作 ref 解析，失败再当 oid
    if let Ok(reference) = repo.find_reference(spec) {
        return Ok(repo.reference_to_annotated_commit(&reference)?);
    }
    if let Ok(reference) = repo.resolve_reference_from_short_name(spec) {
        return Ok(repo.reference_to_annotated_commit(&reference)?);
    }
    let oid = git2::Oid::from_str(spec).map_err(|_| {
        GitError::OperationFailed(format!("无法识别的分支或提交：{spec}"))
    })?;
    Ok(repo.find_annotated_commit(oid)?)
}

fn fast_forward(repo: &Repository, target: &git2::AnnotatedCommit<'_>) -> GitResult<()> {
    let head_ref = repo.head()?;
    if head_ref.is_branch() {
        let refname = head_ref
            .name()
            .ok_or_else(|| GitError::OperationFailed("HEAD 没有 ref 名".to_string()))?
            .to_string();
        let mut reference = repo.find_reference(&refname)?;
        reference.set_target(target.id(), "Fast-forward")?;
        repo.set_head(&refname)?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
        Ok(())
    } else {
        Err(GitError::OperationFailed(
            "HEAD 处于 detached 状态，无法 fast-forward".to_string(),
        ))
    }
}

fn read_merge_msg(repo: &Repository) -> Option<String> {
    let path = repo.path().join("MERGE_MSG");
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn default_merge_message(
    repo: &Repository,
    source_spec: &str,
    source: &git2::Commit<'_>,
) -> String {
    let target = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "HEAD".to_string());
    let subject = source.summary().unwrap_or("").to_string();
    if subject.is_empty() {
        format!("Merge {source_spec} into {target}")
    } else {
        format!("Merge {source_spec} into {target}\n\n{subject}")
    }
}
