use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use git2::{Index, Repository};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;

const WATCH_DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchEventBatch {
    pub paths: Vec<PathBuf>,
    pub needs_rescan: bool,
}

pub type WatchEventResult = Result<WatchEventBatch, notify::Error>;

enum WatchMessage {
    Event(Result<Event, notify::Error>),
    Stop,
}

pub struct WatchHandle {
    watcher: Option<RecommendedWatcher>,
    stop_tx: mpsc::Sender<WatchMessage>,
    worker: Option<JoinHandle<()>>,
}

impl WatchHandle {
    fn new<F>(watch_root: PathBuf, callback: F) -> notify::Result<Self>
    where
        F: Fn(WatchEventResult) + Send + 'static,
    {
        let (tx, rx) = mpsc::channel();
        let tx_for_watcher = tx.clone();
        let worker = thread::Builder::new()
            .name("gitui watcher debounce".to_string())
            .spawn(move || run_debounce_loop(rx, WATCH_DEBOUNCE, callback))
            .map_err(notify::Error::io)?;

        let mut watcher = RecommendedWatcher::new(
            move |event| {
                let _ = tx_for_watcher.send(WatchMessage::Event(event));
            },
            Config::default(),
        )?;
        watcher.watch(&watch_root, RecursiveMode::Recursive)?;

        Ok(Self {
            watcher: Some(watcher),
            stop_tx: tx,
            worker: Some(worker),
        })
    }
}

impl Drop for WatchHandle {
    fn drop(&mut self) {
        self.watcher.take();
        let _ = self.stop_tx.send(WatchMessage::Stop);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn run_debounce_loop<F>(rx: mpsc::Receiver<WatchMessage>, debounce: Duration, callback: F)
where
    F: Fn(WatchEventResult),
{
    let mut pending_paths = BTreeSet::new();
    let mut needs_rescan = false;
    let mut deadline: Option<Instant> = None;

    loop {
        let message = match deadline {
            Some(when) => match rx.recv_timeout(when.saturating_duration_since(Instant::now())) {
                Ok(message) => Some(message),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    flush_debounced_batch(&mut pending_paths, &mut needs_rescan, &callback);
                    deadline = None;
                    None
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            },
            None => match rx.recv() {
                Ok(message) => Some(message),
                Err(_) => break,
            },
        };

        let Some(message) = message else {
            continue;
        };

        match message {
            WatchMessage::Stop => break,
            WatchMessage::Event(Ok(event)) => {
                if event.need_rescan() || event.paths.is_empty() {
                    needs_rescan = true;
                }
                pending_paths.extend(event.paths);
                deadline = Some(Instant::now() + debounce);
            }
            WatchMessage::Event(Err(err)) => callback(Err(err)),
        }
    }
}

fn flush_debounced_batch<F>(
    pending_paths: &mut BTreeSet<PathBuf>,
    needs_rescan: &mut bool,
    callback: &F,
) where
    F: Fn(WatchEventResult),
{
    if pending_paths.is_empty() && !*needs_rescan {
        return;
    }

    let batch = WatchEventBatch {
        paths: std::mem::take(pending_paths).into_iter().collect(),
        needs_rescan: std::mem::take(needs_rescan),
    };
    callback(Ok(batch));
}

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

    fn build_handle<F>(
        watch_root: PathBuf,
        ignore_filter: Option<Arc<IgnoreFilter>>,
        callback: F,
    ) -> notify::Result<WatchHandle>
    where
        F: Fn(WatchEventResult) + Send + 'static,
    {
        let filtered = move |result: WatchEventResult| match result {
            Ok(batch) => {
                if let Some(relevant) = filter_watch_batch(batch, ignore_filter.as_ref()) {
                    callback(Ok(relevant));
                }
            }
            Err(errs) => callback(Err(errs)),
        };

        WatchHandle::new(watch_root, filtered)
    }

    /// 只保留指定仓库的 watcher。用于激活仓库切换，避免后台监听非激活仓库。
    pub fn watch_only<F>(
        &self,
        repo_id: String,
        watch_root: PathBuf,
        ignore_filter: Option<Arc<IgnoreFilter>>,
        callback: F,
    ) -> notify::Result<()>
    where
        F: Fn(WatchEventResult) + Send + 'static,
    {
        let mut watchers = self.watchers.lock();
        watchers.clear();
        let handle = Self::build_handle(watch_root, ignore_filter, callback)?;
        watchers.insert(repo_id, handle);
        Ok(())
    }

    pub fn unwatch(&self, repo_id: &str) {
        let mut watchers = self.watchers.lock();
        watchers.remove(repo_id);
    }

    pub fn unwatch_all(&self) {
        let mut watchers = self.watchers.lock();
        watchers.clear();
    }

    #[cfg(test)]
    fn watcher_count(&self) -> usize {
        self.watchers.lock().len()
    }
}

fn filter_watch_batch(
    batch: WatchEventBatch,
    ignore_filter: Option<&Arc<IgnoreFilter>>,
) -> Option<WatchEventBatch> {
    if batch.needs_rescan {
        return Some(batch);
    }

    let Some(filter) = ignore_filter else {
        return (!batch.paths.is_empty()).then_some(batch);
    };

    let Ok(repo) = Repository::open(&filter.root) else {
        return Some(batch);
    };
    let Ok(index) = repo.index() else {
        return Some(batch);
    };

    let relevant = batch
        .paths
        .into_iter()
        .filter(|path| !filter.should_ignore_with_git(&repo, &index, path))
        .collect::<Vec<_>>();

    (!relevant.is_empty()).then_some(WatchEventBatch {
        paths: relevant,
        needs_rescan: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use notify::EventKind;
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
    fn debounce_loop_preserves_pathless_rescan_signal() {
        let (tx, rx) = mpsc::channel();
        let (batch_tx, batch_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            run_debounce_loop(rx, Duration::from_millis(1), move |result| {
                batch_tx.send(result.unwrap()).unwrap();
            });
        });

        tx.send(WatchMessage::Event(Ok(Event::new(EventKind::Other))))
            .unwrap();
        let batch = batch_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        tx.send(WatchMessage::Stop).unwrap();
        worker.join().unwrap();

        assert!(batch.needs_rescan);
        assert!(batch.paths.is_empty());
    }

    #[test]
    fn ignored_batch_without_rescan_is_filtered_out() {
        let (dir, _repo, filter) = init_repo();
        fs::write(dir.path().join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(dir.path().join("ignored.txt"), "ignored").unwrap();

        let batch = WatchEventBatch {
            paths: vec![dir.path().join("ignored.txt")],
            needs_rescan: false,
        };

        assert!(filter_watch_batch(batch, Some(&filter)).is_none());
    }

    #[test]
    fn rescan_batch_is_not_filtered_out() {
        let (dir, _repo, filter) = init_repo();
        fs::write(dir.path().join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(dir.path().join("ignored.txt"), "ignored").unwrap();

        let batch = WatchEventBatch {
            paths: vec![dir.path().join("ignored.txt")],
            needs_rescan: true,
        };

        let filtered = filter_watch_batch(batch, Some(&filter)).unwrap();
        assert!(filtered.needs_rescan);
    }

    #[test]
    fn paths_outside_repo_are_not_filtered() {
        let (_dir, _repo, filter) = init_repo();
        let other = tempfile::tempdir().unwrap();

        assert!(!filter.should_ignore(&other.path().join("ignored.txt")));
    }

    #[test]
    fn watch_only_replaces_previous_watcher() {
        let service = WatcherService::new();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();

        service
            .watch_only(
                "repo-1".to_string(),
                first.path().to_path_buf(),
                None,
                |_| {},
            )
            .unwrap();
        assert_eq!(service.watcher_count(), 1);

        service
            .watch_only(
                "repo-2".to_string(),
                second.path().to_path_buf(),
                None,
                |_| {},
            )
            .unwrap();

        let watchers = service.watchers.lock();
        assert_eq!(watchers.len(), 1);
        assert!(watchers.contains_key("repo-2"));
    }

    #[test]
    fn unwatch_all_clears_active_watcher() {
        let service = WatcherService::new();
        let dir = tempfile::tempdir().unwrap();

        service
            .watch_only("repo-1".to_string(), dir.path().to_path_buf(), None, |_| {})
            .unwrap();
        service.unwatch_all();

        assert_eq!(service.watcher_count(), 0);
    }
}
