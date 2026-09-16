use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, OnceLock,
    },
};

use git2::Oid;
use parking_lot::Mutex;

use crate::git::{error::GitResult, types::LogBranchScope};

const MAX_SNAPSHOTS: usize = 4;
const MAX_CACHED_ROWS: usize = 250_000;

#[derive(Debug, Clone, PartialEq)]
pub(super) struct LogKey {
    pub git_dir: PathBuf,
    pub roots: Vec<Oid>,
    pub reachable_roots: Vec<Oid>,
    pub stashes: Vec<Oid>,
    pub reflog: Vec<Oid>,
    pub shallow: Vec<u8>,
    pub branch_scope: LogBranchScope,
    pub include_unreachable: bool,
    pub include_stashes: bool,
    pub include_remote_branches: bool,
}

#[derive(Clone, Copy)]
pub(super) struct CachedCommit {
    pub oid: Oid,
    pub is_unreachable: bool,
    pub is_stash: bool,
    pub is_reflog_tip: bool,
}

pub(super) struct LogSnapshot {
    pub id: String,
    pub commits: Vec<CachedCommit>,
}

struct Entry {
    key: LogKey,
    id: String,
    snapshot: Mutex<Option<Arc<LogSnapshot>>>,
    rows: AtomicUsize,
}

#[derive(Default)]
struct LogCache {
    entries: Mutex<VecDeque<Arc<Entry>>>,
}

impl LogCache {
    fn load(
        &self,
        key: LogKey,
        build: impl FnOnce() -> GitResult<Vec<CachedCommit>>,
    ) -> GitResult<Arc<LogSnapshot>> {
        static NEXT_ID: AtomicU64 = AtomicU64::new(1);
        let entry = {
            let mut entries = self.entries.lock();
            let entry = if let Some(index) = entries.iter().position(|entry| entry.key == key) {
                entries.remove(index).unwrap()
            } else {
                Arc::new(Entry {
                    key,
                    id: NEXT_ID.fetch_add(1, Ordering::Relaxed).to_string(),
                    snapshot: Mutex::new(None),
                    rows: AtomicUsize::new(0),
                })
            };
            entries.push_back(Arc::clone(&entry));
            while entries.len() > MAX_SNAPSHOTS {
                entries.pop_front();
            }
            entry
        };

        // 只锁住同一快照的构建，不跨仓库串行 revwalk；不持有全局缓存锁做 I/O。
        let result = {
            let mut slot = entry.snapshot.lock();
            if let Some(snapshot) = slot.as_ref() {
                return Ok(Arc::clone(snapshot));
            }
            let snapshot = Arc::new(LogSnapshot {
                id: entry.id.clone(),
                commits: build()?,
            });
            entry
                .rows
                .store(snapshot.commits.capacity(), Ordering::Relaxed);
            *slot = Some(Arc::clone(&snapshot));
            snapshot
        };
        self.trim();
        Ok(result)
    }

    fn trim(&self) {
        let entries = self.entries.lock();
        let mut rows: usize = entries
            .iter()
            .map(|entry| entry.rows.load(Ordering::Relaxed))
            .sum();
        for entry in entries.iter() {
            if rows <= MAX_CACHED_ROWS {
                break;
            }
            if let Some(mut slot) = entry.snapshot.try_lock() {
                *slot = None;
                rows = rows.saturating_sub(entry.rows.swap(0, Ordering::Relaxed));
            }
        }
    }

    fn clear(&self, git_dir: &Path) {
        self.entries
            .lock()
            .retain(|entry| entry.key.git_dir != git_dir);
    }
}

fn cache() -> &'static LogCache {
    static CACHE: OnceLock<LogCache> = OnceLock::new();
    CACHE.get_or_init(LogCache::default)
}

pub(super) fn load(
    key: LogKey,
    build: impl FnOnce() -> GitResult<Vec<CachedCommit>>,
) -> GitResult<Arc<LogSnapshot>> {
    cache().load(key, build)
}

pub(super) fn clear(git_dir: &Path) {
    cache().clear(git_dir);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::error::GitError;

    fn key(repo: &str) -> LogKey {
        LogKey {
            git_dir: PathBuf::from(repo),
            roots: vec![Oid::zero()],
            reachable_roots: Vec::new(),
            stashes: Vec::new(),
            reflog: Vec::new(),
            shallow: Vec::new(),
            branch_scope: LogBranchScope::All,
            include_unreachable: false,
            include_stashes: false,
            include_remote_branches: true,
        }
    }

    fn row() -> CachedCommit {
        CachedCommit {
            oid: Oid::zero(),
            is_unreachable: false,
            is_stash: false,
            is_reflog_tip: false,
        }
    }

    #[test]
    fn concurrent_pages_build_one_snapshot() {
        let cache = LogCache::default();
        let builds = AtomicUsize::new(0);
        let gate = std::sync::Barrier::new(4);
        std::thread::scope(|scope| {
            let handles: Vec<_> = (0..4)
                .map(|_| {
                    scope.spawn(|| {
                        gate.wait();
                        cache
                            .load(key("repo"), || {
                                builds.fetch_add(1, Ordering::Relaxed);
                                Ok(vec![row()])
                            })
                            .unwrap()
                    })
                })
                .collect();
            let snapshots: Vec<_> = handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect();
            assert!(snapshots
                .iter()
                .all(|snapshot| Arc::ptr_eq(snapshot, &snapshots[0])));
        });
        assert_eq!(builds.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn changed_inputs_and_explicit_close_do_not_reuse_snapshots() {
        let cache = LogCache::default();
        let original_key = key("repo");
        let original = cache
            .load(original_key.clone(), || Ok(vec![row()]))
            .unwrap();
        let mut changed_key = original_key.clone();
        changed_key.include_stashes = true;
        let changed = cache.load(changed_key, || Ok(vec![row()])).unwrap();
        assert_ne!(original.id, changed.id);
        let other = cache.load(key("other"), || Ok(vec![row()])).unwrap();
        cache.clear(Path::new("repo"));
        let reopened = cache.load(original_key, || Ok(vec![row()])).unwrap();
        assert_ne!(original.id, reopened.id);
        assert!(Arc::ptr_eq(
            &other,
            &cache
                .load(key("other"), || panic!("other repository was evicted"))
                .unwrap()
        ));
    }

    #[test]
    fn cache_evicts_least_recent_snapshot_and_bounds_retained_rows() {
        let cache = LogCache::default();
        let first = cache.load(key("first"), || Ok(vec![row()])).unwrap();
        for index in 0..MAX_SNAPSHOTS {
            cache
                .load(key(&format!("repo-{index}")), || Ok(vec![row()]))
                .unwrap();
        }
        let reread = cache.load(key("first"), || Ok(vec![row()])).unwrap();
        assert_ne!(first.id, reread.id);
        let oversized = cache
            .load(key("large"), || Ok(vec![row(); MAX_CACHED_ROWS + 1]))
            .unwrap();
        assert_eq!(oversized.commits.len(), MAX_CACHED_ROWS + 1);
        assert!(
            cache
                .entries
                .lock()
                .iter()
                .map(|entry| entry.rows.load(Ordering::Relaxed))
                .sum::<usize>()
                <= MAX_CACHED_ROWS
        );
        // 超限时释放行缓存但保留入口身份，连续分页不会仅因容量上限而变化快照。
        let rebuilt = cache
            .load(key("large"), || Ok(vec![row(); MAX_CACHED_ROWS + 1]))
            .unwrap();
        assert_eq!(oversized.id, rebuilt.id);
    }

    #[test]
    fn failed_build_can_be_retried() {
        let cache = LogCache::default();
        assert!(cache
            .load(key("repo"), || Err(GitError::OperationFailed(
                "temporary failure".into()
            )))
            .is_err());
        assert_eq!(
            cache
                .load(key("repo"), || Ok(vec![row()]))
                .unwrap()
                .commits
                .len(),
            1
        );
    }
}
