use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use git2::{Index, Repository};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;

// 从批次首事件起算的合并窗口；持续写入（包括 ignored 文件）不能延后期限。
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
    fn new<F>(watch_roots: Vec<PathBuf>, callback: F) -> notify::Result<Self>
    where
        F: Fn(WatchEventResult) + Send + 'static,
    {
        let (tx, rx) = mpsc::channel();
        let tx_for_watcher = tx.clone();

        let mut watcher = RecommendedWatcher::new(
            move |event| {
                let _ = tx_for_watcher.send(WatchMessage::Event(event));
            },
            Config::default(),
        )?;
        for root in watch_roots {
            watcher.watch(&root, RecursiveMode::Recursive)?;
        }

        let worker = thread::Builder::new()
            .name("gitui watcher debounce".to_string())
            .spawn(move || run_debounce_loop(rx, WATCH_DEBOUNCE, callback))
            .map_err(notify::Error::io)?;

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
        // recv_timeout 即使超时也可能先取出已排队的消息，必须先检查期限，
        // 否则事件队列持续非空时仍然无法派发（包括 rescan）。
        if deadline.is_some_and(|when| Instant::now() >= when) {
            flush_debounced_batch(&mut pending_paths, &mut needs_rescan, &callback);
            deadline = None;
        }

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
                deadline.get_or_insert_with(|| Instant::now() + debounce);
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

/// 工作目录与真实 Git 元数据路径；路径别名只在激活仓库时解析。
#[derive(Clone, Debug)]
pub struct WatchPaths {
    work_dirs: Vec<PathBuf>,
    git_dirs: Vec<PathBuf>,
    watch_roots: Vec<PathBuf>,
}

impl WatchPaths {
    pub(crate) fn new(root: &Path, git_dir: &Path, common_dir: &Path) -> Self {
        fn aliases(path: &Path) -> Vec<PathBuf> {
            let mut paths = vec![path.to_path_buf()];
            if let Ok(canonical) = path.canonicalize() {
                if canonical != path {
                    paths.push(canonical);
                }
            }
            paths
        }
        let work_dirs = aliases(root);
        // 实际 gitdir 必须优先于包含它的 commondir，以正确识别 worktree 的 index / HEAD。
        let mut git_dirs = aliases(git_dir);
        git_dirs.extend(aliases(common_dir));
        git_dirs.extend(aliases(&root.join(".git")));
        let candidates: BTreeSet<_> = [root, git_dir, common_dir]
            .into_iter()
            .map(|path| path.canonicalize().unwrap_or_else(|_| path.to_path_buf()))
            .collect();
        let watch_roots = candidates
            .iter()
            .filter(|path| {
                !candidates
                    .iter()
                    .any(|other| *path != other && path.starts_with(other))
            })
            .cloned()
            .collect();
        Self {
            work_dirs,
            git_dirs,
            watch_roots,
        }
    }

    pub(crate) fn metadata_relative<'a>(&self, path: &'a Path) -> Option<&'a Path> {
        self.git_dirs
            .iter()
            .find_map(|root| path.strip_prefix(root).ok())
    }

    pub(crate) fn worktree_relative<'a>(&self, path: &'a Path) -> Option<&'a Path> {
        self.work_dirs
            .iter()
            .find_map(|root| path.strip_prefix(root).ok())
    }
}

/// 路径过滤器：使用 libgit2 的 ignore 规则为 watcher 事件减噪。
///
/// 过滤只针对未跟踪路径；已跟踪文件即使命中 ignore 规则也必须放行。
pub struct IgnoreFilter {
    paths: WatchPaths,
}

impl IgnoreFilter {
    /// 构造一个 filter。实际 ignore 规则在事件批次到达时从仓库读取。
    pub fn build(root: PathBuf) -> Arc<Self> {
        let paths = match Repository::open(&root) {
            Ok(repo) => WatchPaths::new(&root, repo.path(), repo.commondir()),
            Err(_) => WatchPaths::new(&root, &root.join(".git"), &root.join(".git")),
        };
        Arc::new(Self { paths })
    }

    pub(crate) fn paths(&self) -> &WatchPaths {
        &self.paths
    }

    /// 判断一个绝对路径是否应该被 ignore。
    ///
    /// 规则：
    /// - 实际 gitdir、commondir 和 `.git` 指针事件永远放行
    /// - 仓库外路径放行（理论上 notify 不会给出这种事件）
    /// - 已跟踪路径放行，即使命中 ignore 规则
    /// - 未跟踪路径交给 libgit2 的 ignore 规则判断，命中则丢弃
    /// - 任意错误都放行，避免漏掉状态刷新
    #[cfg(test)]
    fn should_ignore(&self, abs: &Path) -> bool {
        let Ok(repo) = Repository::open(&self.paths.work_dirs[0]) else {
            return false;
        };
        let Ok(index) = repo.index() else {
            return false;
        };
        self.should_ignore_with_git(&repo, &index, abs)
    }

    fn should_ignore_with_git(&self, repo: &Repository, index: &Index, abs: &Path) -> bool {
        if self.paths.metadata_relative(abs).is_some() {
            return false;
        }
        let Some(rel) = self.paths.worktree_relative(abs) else {
            return false;
        };

        if index.get_path(rel, 0).is_some() {
            return false;
        }

        repo.status_should_ignore(rel).unwrap_or(false)
    }
}

#[derive(Clone)]
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
        let watch_roots = ignore_filter
            .as_ref()
            .map(|filter| filter.paths.watch_roots.clone())
            .unwrap_or_else(|| vec![watch_root]);
        let filtered = move |result: WatchEventResult| match result {
            Ok(batch) => {
                let path_count = batch.paths.len();
                if let Some(relevant) = filter_watch_batch(batch, ignore_filter.as_ref()) {
                    log::debug!(
                        "[watcher] batch paths={} relevant={} rescan={}",
                        path_count,
                        relevant.paths.len(),
                        relevant.needs_rescan
                    );
                    callback(Ok(relevant));
                }
            }
            Err(errs) => callback(Err(errs)),
        };

        WatchHandle::new(watch_roots, filtered)
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

    let Ok(repo) = Repository::open(&filter.paths.work_dirs[0]) else {
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
    fn ordinary_repository_has_one_nonoverlapping_watch_root() {
        let (dir, _repo, filter) = init_repo();
        assert_eq!(
            filter.paths.watch_roots,
            vec![dir.path().canonicalize().unwrap()]
        );
        assert_eq!(
            filter
                .paths
                .metadata_relative(&dir.path().join(".git/index")),
            Some(Path::new("index"))
        );
    }

    fn wait_for_path(rx: &mpsc::Receiver<WatchEventResult>, path: &Path) {
        let path = path.canonicalize().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let batch = rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .expect("watcher did not report the changed path")
                .unwrap();
            if batch.needs_rescan || batch.paths.iter().any(|actual| actual == &path) {
                return;
            }
        }
    }

    fn assert_external_metadata_is_watched(root: &Path, repo: &Repository) {
        let filter = IgnoreFilter::build(root.to_path_buf());
        assert_eq!(filter.paths.watch_roots.len(), 2);
        let service = WatcherService::new();
        let (tx, rx) = mpsc::channel();
        service
            .watch_only(
                "external".into(),
                root.to_path_buf(),
                Some(filter),
                move |batch| {
                    let _ = tx.send(batch);
                },
            )
            .unwrap();
        let ready = root.join("ready.txt");
        fs::write(&ready, "ready").unwrap();
        wait_for_path(&rx, &ready);

        let head = repo.path().join("HEAD");
        fs::write(&head, fs::read(&head).unwrap()).unwrap();
        wait_for_path(&rx, &head);
        let reference = repo.commondir().join("refs/heads/external-change");
        let oid = repo.head().unwrap().target().unwrap();
        fs::write(&reference, format!("{oid}\n")).unwrap();
        wait_for_path(&rx, &reference);

        // 替换激活仓库后，旧 watcher 及其全部外部监听根 / 回调都必须释放。
        let other = tempfile::tempdir().unwrap();
        service
            .watch_only("other".into(), other.path().to_path_buf(), None, |_| {})
            .unwrap();
        while rx.try_recv().is_ok() {}
        assert!(matches!(
            rx.try_recv(),
            Err(mpsc::TryRecvError::Disconnected)
        ));
        assert_eq!(service.watcher_count(), 1);
    }

    #[test]
    fn linked_worktree_watches_private_and_common_metadata() {
        let (_main_dir, main, _) = init_repo();
        commit_file(&main, Path::new("tracked.txt"), "tracked\n");
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("linked");
        main.worktree("linked", &root, None).unwrap();
        let repo = Repository::open(&root).unwrap();
        assert!(root.join(".git").is_file());
        let filter = IgnoreFilter::build(root.clone());
        fs::write(root.join(".gitignore"), "*.txt\n").unwrap();
        assert!(filter.should_ignore(&root.join("ignored.txt")));
        assert!(!filter.should_ignore(&root.join("tracked.txt")));
        assert!(!filter.should_ignore(&repo.path().join("index")));
        assert_eq!(
            filter.paths.metadata_relative(&repo.path().join("index")),
            Some(Path::new("index"))
        );
        assert_eq!(
            filter
                .paths
                .metadata_relative(&repo.commondir().join("refs/heads/new")),
            Some(Path::new("refs/heads/new"))
        );
        // 控制事件使用未被 ignore 的文件。
        fs::write(root.join(".gitignore"), "ignored.txt\n").unwrap();
        assert_external_metadata_is_watched(&root, &repo);
    }

    #[test]
    fn submodule_layout_watches_metadata_outside_its_worktree() {
        let (parent_dir, parent, _) = init_repo();
        let root = parent_dir.path().join("child");
        let mut options = git2::RepositoryInitOptions::new();
        options.no_dotgit_dir(true).workdir_path(&root);
        let child = Repository::init_opts(parent.path().join("modules/child"), &options).unwrap();
        commit_file(&child, Path::new("tracked.txt"), "tracked\n");
        assert!(root.join(".git").is_file());
        let filter = IgnoreFilter::build(root.clone());
        assert!(!filter.should_ignore(&child.path().join("HEAD")));
        assert!(!filter.should_ignore(&root.join(".git")));
        assert_external_metadata_is_watched(&root, &child);
    }

    #[cfg(unix)]
    #[test]
    fn canonical_aliases_keep_ignore_rules_for_deleted_paths() {
        let (dir, repo, _) = init_repo();
        commit_file(&repo, Path::new("tracked.log"), "tracked\n");
        fs::write(dir.path().join(".gitignore"), "*.log\n").unwrap();
        let outer = tempfile::tempdir().unwrap();
        let alias = outer.path().join("alias");
        std::os::unix::fs::symlink(dir.path(), &alias).unwrap();
        let filter = IgnoreFilter::build(alias.clone());
        fs::remove_file(dir.path().join("tracked.log")).unwrap();
        assert!(!filter.should_ignore(&alias.join("tracked.log")));
        assert!(!filter.should_ignore(&dir.path().canonicalize().unwrap().join("tracked.log")));
        assert!(filter.should_ignore(&alias.join("ignored.log")));
        assert!(filter.should_ignore(&dir.path().canonicalize().unwrap().join("ignored.log")));
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
    fn queued_events_cannot_starve_an_expired_batch() {
        let (tx, rx) = mpsc::channel();
        let (batch_tx, batch_rx) = mpsc::channel();
        // 队列始终非空：即使末尾已有 Stop，也必须先派发已到期的批次。
        tx.send(WatchMessage::Event(Ok(Event::new(EventKind::Other))))
            .unwrap();
        tx.send(WatchMessage::Stop).unwrap();
        run_debounce_loop(rx, Duration::ZERO, |batch| {
            batch_tx.send(batch.unwrap()).unwrap();
        });

        assert!(batch_rx.try_recv().unwrap().needs_rescan);
    }

    #[test]
    fn continuous_ignored_events_do_not_delay_changes_or_rescan() {
        use std::sync::atomic::{AtomicBool, Ordering};

        for rescan in [false, true] {
            let (dir, _repo, filter) = init_repo();
            fs::write(dir.path().join(".gitignore"), "build.log\n").unwrap();
            fs::write(dir.path().join("build.log"), "noise").unwrap();
            let relevant_path = dir.path().join(".git/refs/heads/main");
            let noise_path = dir.path().join("build.log");
            let (tx, rx) = mpsc::channel();
            let (batch_tx, batch_rx) = mpsc::channel();
            let worker = thread::spawn(move || {
                run_debounce_loop(rx, Duration::from_millis(40), |result| {
                    if let Some(batch) = filter_watch_batch(result.unwrap(), Some(&filter)) {
                        batch_tx.send(batch).unwrap();
                    }
                });
            });
            let event = if rescan {
                Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan)
            } else {
                Event::new(EventKind::Any).add_path(relevant_path.clone())
            };
            tx.send(WatchMessage::Event(Ok(event))).unwrap();

            let stop_noise = Arc::new(AtomicBool::new(false));
            let noise_stop = stop_noise.clone();
            let noise_tx = tx.clone();
            let noise_worker = thread::spawn(move || {
                while !noise_stop.load(Ordering::Relaxed) {
                    noise_tx
                        .send(WatchMessage::Event(Ok(
                            Event::new(EventKind::Any).add_path(noise_path.clone())
                        )))
                        .unwrap();
                    thread::sleep(Duration::from_millis(2));
                }
            });

            // 在噪声仍持续期间必须收到通知；先清理线程，再断言，避免失败时泄漏。
            let during_noise = batch_rx.recv_timeout(Duration::from_secs(1));
            stop_noise.store(true, Ordering::Relaxed);
            noise_worker.join().unwrap();

            // 末尾的另一条有效事件也不能随上一个窗口被清掉。
            let tail = dir.path().join("src/tail.rs");
            tx.send(WatchMessage::Event(Ok(
                Event::new(EventKind::Any).add_path(tail.clone())
            )))
            .unwrap();
            let tail_batch = batch_rx.recv_timeout(Duration::from_secs(1));
            tx.send(WatchMessage::Stop).unwrap();
            worker.join().unwrap();

            let batch = during_noise.expect("ignored noise starved the pending change");
            assert_eq!(batch.needs_rescan, rescan);
            if !rescan {
                assert_eq!(batch.paths, vec![relevant_path]);
            }
            assert_eq!(tail_batch.unwrap().paths, vec![tail]);
            assert!(batch_rx.try_recv().is_err());
        }
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
