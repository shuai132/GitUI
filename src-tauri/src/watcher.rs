use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use notify::RecursiveMode;

pub type WatchHandle = Debouncer<RecommendedWatcher>;

pub struct WatcherService {
    watchers: Arc<Mutex<HashMap<String, WatchHandle>>>,
}

impl WatcherService {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn watch<F>(&self, repo_id: String, git_dir: PathBuf, callback: F) -> notify::Result<()>
    where
        F: Fn(DebounceEventResult) + Send + 'static,
    {
        let mut debouncer = new_debouncer(Duration::from_millis(300), callback)?;
        debouncer.watcher().watch(&git_dir, RecursiveMode::Recursive)?;

        let mut watchers = self.watchers.lock().unwrap();
        watchers.insert(repo_id, debouncer);
        Ok(())
    }

    pub fn unwatch(&self, repo_id: &str) {
        let mut watchers = self.watchers.lock().unwrap();
        watchers.remove(repo_id);
    }
}
