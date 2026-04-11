use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::RecommendedWatcher;
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use parking_lot::Mutex;

pub type WatchHandle = Debouncer<RecommendedWatcher>;

/// 路径过滤器：包装一个 `Gitignore` matcher + 仓库根路径，供 watcher 回调使用。
///
/// 只读仓库根的 `.gitignore`（不递归嵌套、不读全局 core.excludesfile），
/// 对主要痛点场景（node_modules / target / dist）足够。
pub struct IgnoreFilter {
    root: PathBuf,
    matcher: Gitignore,
    git_dir: PathBuf,
}

impl IgnoreFilter {
    /// 构造一个 filter。若 `<root>/.gitignore` 不存在或读取失败，
    /// 仍会返回一个只含硬编码规则的空 matcher（`.git/` 内部总是放行）。
    pub fn build(root: PathBuf) -> Arc<Self> {
        let mut builder = GitignoreBuilder::new(&root);
        let gi_path = root.join(".gitignore");
        if gi_path.exists() {
            // add() 返回 Option<Error>（Some 表示 glob 语法错误）——忽略，
            // 有问题的 pattern 自动跳过，其他规则仍然生效。
            let _ = builder.add(&gi_path);
        }
        let matcher = builder.build().unwrap_or_else(|_| Gitignore::empty());
        let git_dir = root.join(".git");
        Arc::new(Self {
            root,
            matcher,
            git_dir,
        })
    }

    /// 判断一个绝对路径是否应该被 ignore。
    ///
    /// 规则：
    /// - `.git/` 内部永远放行（是我们最关心的信号）
    /// - 仓库外路径放行（理论上 notify 不会给出这种事件）
    /// - 其他路径交给 gitignore matcher，命中则丢弃
    pub fn should_ignore(&self, abs: &Path) -> bool {
        if abs.starts_with(&self.git_dir) {
            return false;
        }
        let Ok(rel) = abs.strip_prefix(&self.root) else {
            return false;
        };
        // is_dir 在路径已删除的场景可能返回 false——这时候用父目录命中判断兜底。
        // matched_path_or_any_parents 会检查路径本身和任何父目录是否被 ignore，
        // 所以 node_modules/foo.js 这种子文件事件也能通过父目录规则被丢弃。
        let is_dir = abs.is_dir();
        self.matcher
            .matched_path_or_any_parents(rel, is_dir)
            .is_ignore()
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
                    events
                        .into_iter()
                        .filter(|e| !filter.should_ignore(&e.path))
                        .collect()
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
