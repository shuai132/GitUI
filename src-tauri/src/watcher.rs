use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use git2::{Index, Repository};
use notify::RecommendedWatcher;
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use parking_lot::Mutex;

pub type WatchHandle = Debouncer<RecommendedWatcher>;

/// 路径过滤器：使用 libgit2 的 ignore 规则为 watcher 事件减噪。
///
/// 过滤只针对未跟踪路径；已跟踪文件即使命中 ignore 规则也必须放行。
pub struct IgnoreFilter {
    root: PathBuf,
    git_dir: PathBuf,
}

impl IgnoreFilter {
    /// 构造一个 filter。实际 ignore 规则在事件批次到达时从仓库读取。
    pub fn build(root: PathBuf) -> Arc<Self> {
        let git_dir = root.join(".git");
        Arc::new(Self { root, git_dir })
    }

    /// 判断一个绝对路径是否应该被 ignore。
    ///
    /// 规则：
    /// - `.git/` 内部永远放行（是我们最关心的信号）
    /// - 仓库外路径放行（理论上 notify 不会给出这种事件）
    /// - 已跟踪路径放行，即使命中 ignore 规则
    /// - 未跟踪路径交给 libgit2 的 ignore 规则判断，命中则丢弃
    /// - 任意错误都放行，避免漏掉状态刷新
    #[cfg(test)]
    fn should_ignore(&self, abs: &Path) -> bool {
        let Ok(repo) = Repository::open(&self.root) else {
            return false;
        };
        let Ok(index) = repo.index() else {
            return false;
        };
        self.should_ignore_with_git(&repo, &index, abs)
    }

    fn should_ignore_with_git(&self, repo: &Repository, index: &Index, abs: &Path) -> bool {
        if abs.starts_with(&self.git_dir) {
            return false;
        }
        let Ok(rel) = abs.strip_prefix(&self.root) else {
            return false;
        };

        if index.get_path(rel, 0).is_some() {
            return false;
        }

        repo.status_should_ignore(rel).unwrap_or(false)
    }
}

pub struct WatcherService {
    watchers: Arc<Mutex<HashMap<String, WatchHandle>>>,
}

impl WatcherService {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 开始监听 `watch_root`，对每一批防抖后的事件做 gitignore 过滤，
    /// 留下至少一条时调用 `callback`。
    pub fn watch<F>(
        &self,
        repo_id: String,
        watch_root: PathBuf,
        ignore_filter: Option<Arc<IgnoreFilter>>,
        callback: F,
    ) -> notify::Result<()>
    where
        F: Fn(DebounceEventResult) + Send + 'static,
    {
        let filtered = move |result: DebounceEventResult| match result {
            Ok(events) => {
                let relevant: Vec<_> = if let Some(filter) = &ignore_filter {
                    if let Ok(repo) = Repository::open(&filter.root) {
                        if let Ok(index) = repo.index() {
                            events
                                .into_iter()
                                .filter(|e| !filter.should_ignore_with_git(&repo, &index, &e.path))
                                .collect()
                        } else {
                            events
                        }
                    } else {
                        events
                    }
                } else {
                    events
                };
                if !relevant.is_empty() {
                    callback(Ok(relevant));
                }
            }
            Err(errs) => callback(Err(errs)),
        };

        let mut debouncer = new_debouncer(Duration::from_millis(300), filtered)?;
        debouncer
            .watcher()
            .watch(&watch_root, RecursiveMode::Recursive)?;

        let mut watchers = self.watchers.lock();
        watchers.insert(repo_id, debouncer);
        Ok(())
    }

    pub fn unwatch(&self, repo_id: &str) {
        let mut watchers = self.watchers.lock();
        watchers.remove(repo_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use std::fs;
    use tempfile::TempDir;

    fn init_repo() -> (TempDir, Repository, Arc<IgnoreFilter>) {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let filter = IgnoreFilter::build(dir.path().to_path_buf());
        (dir, repo, filter)
    }

    fn commit_file(repo: &Repository, path: &Path, content: &str) {
        let workdir = repo.workdir().unwrap();
        let abs = workdir.join(path);
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(abs, content).unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(path).unwrap();
        index.write().unwrap();

        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let sig = Signature::now("test", "test@test.com").unwrap();
        let parents = match repo.head() {
            Ok(head) => vec![head.peel_to_commit().unwrap()],
            Err(_) => Vec::new(),
        };
        let parent_refs = parents.iter().collect::<Vec<_>>();
        repo.commit(Some("HEAD"), &sig, &sig, "commit", &tree, &parent_refs)
            .unwrap();
    }

    #[test]
    fn root_gitignore_filters_untracked_path() {
        let (dir, _repo, filter) = init_repo();
        fs::write(dir.path().join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(dir.path().join("ignored.txt"), "ignored").unwrap();

        assert!(filter.should_ignore(&dir.path().join("ignored.txt")));
    }

    #[test]
    fn nested_gitignore_filters_untracked_path() {
        let (dir, _repo, filter) = init_repo();
        fs::create_dir_all(dir.path().join("nested")).unwrap();
        fs::write(dir.path().join("nested/.gitignore"), "ignored.txt\n").unwrap();
        fs::write(dir.path().join("nested/ignored.txt"), "ignored").unwrap();

        assert!(filter.should_ignore(&dir.path().join("nested/ignored.txt")));
    }

    #[test]
    fn info_exclude_filters_untracked_path() {
        let (dir, _repo, filter) = init_repo();
        fs::write(dir.path().join(".git/info/exclude"), "ignored.txt\n").unwrap();
        fs::write(dir.path().join("ignored.txt"), "ignored").unwrap();

        assert!(filter.should_ignore(&dir.path().join("ignored.txt")));
    }

    #[test]
    fn core_excludes_file_filters_untracked_path() {
        let (dir, repo, filter) = init_repo();
        let global_ignore = dir.path().join("global-ignore");
        fs::write(&global_ignore, "ignored.txt\n").unwrap();
        repo.config()
            .unwrap()
            .set_str("core.excludesFile", global_ignore.to_str().unwrap())
            .unwrap();
        fs::write(dir.path().join("ignored.txt"), "ignored").unwrap();

        assert!(filter.should_ignore(&dir.path().join("ignored.txt")));
    }

    #[test]
    fn tracked_path_matching_ignore_is_not_filtered() {
        let (dir, repo, filter) = init_repo();
        commit_file(&repo, Path::new("tracked.log"), "tracked\n");
        fs::write(dir.path().join(".gitignore"), "*.log\n").unwrap();
        fs::write(dir.path().join("tracked.log"), "changed\n").unwrap();

        assert!(!filter.should_ignore(&dir.path().join("tracked.log")));
    }

    #[test]
    fn git_dir_events_are_not_filtered() {
        let (dir, _repo, filter) = init_repo();

        assert!(!filter.should_ignore(&dir.path().join(".git/HEAD")));
    }

    #[test]
    fn paths_outside_repo_are_not_filtered() {
        let (_dir, _repo, filter) = init_repo();
        let other = tempfile::tempdir().unwrap();

        assert!(!filter.should_ignore(&other.path().join("ignored.txt")));
    }
}
