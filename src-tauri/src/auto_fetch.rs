use parking_lot::Mutex;
use std::{sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter, Manager, async_runtime::JoinHandle};

use crate::{git::engine::GitEngine, repo_manager::RepoManager};

pub struct AutoFetchService {
    handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl AutoFetchService {
    pub fn new() -> Self {
        Self {
            handle: Arc::new(Mutex::new(None)),
        }
    }

    pub fn start(&self, app: AppHandle) {
        let mut lock = self.handle.lock();
        if lock.is_some() {
            return;
        }
        *lock = Some(tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(5 * 60));
            interval.tick().await; // 跳过立即触发的第一次，避免启动就 fetch
            loop {
                interval.tick().await;
                let repos = app.state::<RepoManager>().list_repos();
                for meta in repos {
                    match GitEngine::list_remotes(&meta.path) {
                        Ok(remotes) => {
                            for remote in remotes {
                                let _ = GitEngine::fetch(&meta.path, &remote);
                            }
                            let _ = app.emit("repo://remote-updated", &meta.id);
                        }
                        Err(e) => {
                            log::warn!("[auto_fetch] list_remotes failed for {}: {e}", meta.id);
                        }
                    }
                }
            }
        }));
    }
}
