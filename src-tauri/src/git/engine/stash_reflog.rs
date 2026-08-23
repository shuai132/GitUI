use git2::{Repository, StashFlags};
use std::collections::HashMap;

use crate::git::{
    encoding::decode_commit_text,
    error::{GitError, GitResult},
    shellout::run_git,
    types::*,
};

use super::GitEngine;

impl GitEngine {
    // ── Stash ──────────────────────────────────────────────────────────

    /// Stash 当前工作区（包含未暂存的变更和 untracked 文件）
    pub fn stash_push(path: &str, message: Option<&str>) -> GitResult<String> {
        let mut repo = Self::open(path)?;
        let sig = repo.signature()?;
        let flags = StashFlags::INCLUDE_UNTRACKED;

        // 如果没有提供消息，生成简洁的 "WIP on {branch}" 格式
        let default_msg = if message.is_none() {
            let branch_name = repo
                .head()
                .ok()
                .and_then(|h| h.shorthand().map(|s| s.to_string()))
                .unwrap_or_else(|| "(no branch)".to_string());
            Some(format!("WIP on {}", branch_name))
        } else {
            None
        };

        let msg = message.or(default_msg.as_deref());
        let oid = repo.stash_save2(&sig, msg, Some(flags))?;
        Ok(oid.to_string())
    }

    /// Pop 指定 index 的 stash（默认 0 即最新一条）；成功后该 stash 被移除。
    pub fn stash_pop(path: &str, index: usize, expected_oid: Option<&str>) -> GitResult<()> {
        let mut repo = Self::open(path)?;
        let stashes = Self::list_stashes(&repo)?;
        let count = stashes.len();
        if count == 0 {
            return Err(GitError::OperationFailed("没有可 pop 的 stash".to_string()));
        }
        if index >= count {
            return Err(GitError::OperationFailed(format!(
                "stash@{{{}}} 不存在（共 {} 条）",
                index, count
            )));
        }
        if let Some(expected) = expected_oid {
            let current = stashes[index].2.to_string();
            if current != expected {
                return Err(GitError::OperationFailed(format!(
                    "Stash target changed: expected {expected}, current {current}"
                )));
            }
        }
        repo.stash_pop(index, None)?;
        Ok(())
    }

    /// Apply 指定 index 的 stash，应用后保留该 stash（不移除）。
    pub fn stash_apply(path: &str, index: usize, expected_oid: &str) -> GitResult<()> {
        let mut repo = Self::open(path)?;
        let stashes = Self::list_stashes(&repo)?;
        let count = stashes.len();
        if count == 0 {
            return Err(GitError::OperationFailed(
                "没有可 apply 的 stash".to_string(),
            ));
        }
        if index >= count {
            return Err(GitError::OperationFailed(format!(
                "stash@{{{}}} 不存在（共 {} 条）",
                index, count
            )));
        }
        let current = stashes[index].2.to_string();
        if current != expected_oid {
            return Err(GitError::OperationFailed(format!(
                "Stash target changed: expected {expected_oid}, current {current}"
            )));
        }
        repo.stash_apply(index, None)?;
        Ok(())
    }

    /// 删除指定 index 的 stash（不 apply）。
    pub fn stash_drop(path: &str, index: usize, expected_oid: Option<&str>) -> GitResult<()> {
        let mut repo = Self::open(path)?;
        let stashes = Self::list_stashes(&repo)?;
        let count = stashes.len();
        if count == 0 {
            return Err(GitError::OperationFailed("没有可删除的 stash".to_string()));
        }
        if index >= count {
            return Err(GitError::OperationFailed(format!(
                "stash@{{{}}} 不存在（共 {} 条）",
                index, count
            )));
        }
        if let Some(expected) = expected_oid {
            let current = stashes[index].2.to_string();
            if current != expected {
                return Err(GitError::OperationFailed(format!(
                    "Stash target changed: expected {expected}, current {current}"
                )));
            }
        }
        repo.stash_drop(index)?;
        Ok(())
    }

    /// 枚举所有 stash —— 直接读 `refs/stash` reflog，语义与 libgit2 的
    /// `git_stash_foreach` 一致。绕开 `git2::Repository::stash_foreach`
    /// 是因为其内部 `CStr::from_ptr(msg).to_str().unwrap()` 会对非 UTF-8
    /// stash message 直接 panic（Windows 上 GBK 等编码常见），这个 panic
    /// 会跨 FFI 重新抛出并让 tokio worker 线程崩溃。
    pub(super) fn list_stashes(repo: &Repository) -> GitResult<Vec<(usize, String, git2::Oid)>> {
        let reflog = match repo.reflog("refs/stash") {
            Ok(r) => r,
            Err(e) if e.code() == git2::ErrorCode::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut out = Vec::with_capacity(reflog.len());
        for (i, entry) in reflog.iter().enumerate() {
            let msg = entry
                .message_bytes()
                .map(|b| decode_commit_text(b, None))
                .unwrap_or_default();
            out.push((i, msg, entry.id_new()));
        }
        Ok(out)
    }

    /// 列出所有 stash 条目
    pub fn stash_list(path: &str) -> GitResult<Vec<StashEntry>> {
        let repo = Self::open(path)?;
        Ok(Self::list_stashes(&repo)?
            .into_iter()
            .map(|(index, message, oid)| StashEntry {
                index,
                message,
                commit_oid: oid.to_string(),
            })
            .collect())
    }

    /// 读取 HEAD 的 reflog，返回最多 `limit` 条记录（最新在前）。
    pub fn get_reflog(path: &str, limit: usize) -> GitResult<Vec<ReflogEntry>> {
        let repo = Self::open(path)?;
        let reflog = repo
            .reflog("HEAD")
            .map_err(|e| GitError::OperationFailed(format!("读取 reflog 失败：{}", e)))?;

        let count = reflog.len().min(limit);
        let mut entries = Vec::with_capacity(count);

        for i in 0..count {
            let entry = reflog.get(i).unwrap();
            let oid = entry.id_new();
            let oid_str = oid.to_string();
            let short_oid = oid_str[..7.min(oid_str.len())].to_string();
            // reflog message 没有自己的 encoding header，按 commit 同等策略走自适应解码
            let message = entry
                .message_bytes()
                .map(|b| decode_commit_text(b, None))
                .unwrap_or_default();
            let committer = entry.committer();
            let committer_name = decode_commit_text(committer.name_bytes(), None);
            let time = committer.when().seconds();
            entries.push(ReflogEntry {
                oid: oid_str,
                short_oid,
                message,
                committer_name,
                time,
            });
        }

        Ok(entries)
    }

    /// 对仓库执行 `git gc`，返回命令输出文本。
    pub fn run_gc(path: &str) -> GitResult<String> {
        run_git(path, &["gc", "--quiet"])?;
        Ok("git gc 完成".to_string())
    }

    /// 计算"让 target 从 HEAD reflog 闭包里消失"所需要移除的 reflog entry 索引集合。
    ///
    /// 算法：对每个 HEAD reflog entry 的 `new_oid x`，当 `x == target` 或 target
    /// 是 x 的祖先时，该 entry 被列入移除集合。相同 `new_oid` 只做一次图关系查询，
    /// 避免在 reflog 较长时反复遍历同一段提交图。
    ///
    /// 抽出独立函数供 `drop_unreachable_commit` 和 `preview_drop_unreachable_commit` 共用。
    fn compute_drop_unreachable_indices(
        repo: &Repository,
        reflog: &git2::Reflog,
        target: git2::Oid,
    ) -> Vec<usize> {
        let mut indices: Vec<usize> = Vec::new();
        let mut hit_cache: HashMap<git2::Oid, bool> = HashMap::new();

        for i in 0..reflog.len() {
            let Some(entry) = reflog.get(i) else { continue };
            let root = entry.id_new();

            let hit = if let Some(hit) = hit_cache.get(&root) {
                *hit
            } else {
                let hit = root == target || repo.graph_descendant_of(root, target).unwrap_or(false);
                hit_cache.insert(root, hit);
                hit
            };

            if hit {
                indices.push(i);
            }
        }
        indices
    }

    /// 从 HEAD reflog 中移除让 `oid` 从 unreachable 视图消失所需的所有 entry（剥链）。
    ///
    /// 行为：
    /// - 对某条 reflog entry，其 `new_oid` 等于 target 或以 target 为祖先时命中，一并删除
    /// - 点 tip（没人把它当祖先）时只删自己；点链中/尾端时会带走所有后代的 reflog 入口
    /// - 对象本身仍留在 `.git/objects/`，由后续 `git gc` 按默认过期策略自然回收
    ///
    /// 返回实际删除的 entry 数（0 表示 reflog 里没有命中项，属幂等情形）。
    /// 不直接写回前可通过 `preview_drop_unreachable_commit` 提前取数，用作二次确认文案。
    pub fn drop_unreachable_commit(path: &str, oid: &str) -> GitResult<usize> {
        let repo = Self::open(path)?;
        let target = git2::Oid::from_str(oid)
            .map_err(|e| GitError::OperationFailed(format!("无效的 oid：{}", e)))?;
        let mut reflog = repo
            .reflog("HEAD")
            .map_err(|e| GitError::OperationFailed(format!("读取 reflog 失败：{}", e)))?;

        let indices = Self::compute_drop_unreachable_indices(&repo, &reflog, target);

        // 从末尾向前删避免索引失效；不重写前一条的 old_oid 链（rewrite_previous_entry = false），
        // 让 reflog 历史反映"entry 被移除"这件事本身，而不是伪造一段连贯的时间线。
        for &i in indices.iter().rev() {
            reflog
                .remove(i, false)
                .map_err(|e| GitError::OperationFailed(format!("移除 reflog 条目失败：{}", e)))?;
        }

        if !indices.is_empty() {
            reflog
                .write()
                .map_err(|e| GitError::OperationFailed(format!("写回 reflog 失败：{}", e)))?;
        }

        Ok(indices.len())
    }

    /// `drop_unreachable_commit` 的 dry-run：只计算将要被移除的 reflog entry 数，不实际写回。
    /// 供前端在二次确认对话框里显示影响范围（"将同时移除 N 条 reflog 引用"）。
    pub fn preview_drop_unreachable_commit(path: &str, oid: &str) -> GitResult<usize> {
        let repo = Self::open(path)?;
        let target = git2::Oid::from_str(oid)
            .map_err(|e| GitError::OperationFailed(format!("无效的 oid：{}", e)))?;
        let reflog = repo
            .reflog("HEAD")
            .map_err(|e| GitError::OperationFailed(format!("读取 reflog 失败：{}", e)))?;
        Ok(Self::compute_drop_unreachable_indices(&repo, &reflog, target).len())
    }
}
