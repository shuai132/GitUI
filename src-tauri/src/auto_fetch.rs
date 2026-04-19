use parking_lot::Mutex;
use std::{sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter, Manager, async_runtime::JoinHandle};

use crate::{git::engine::GitEngine, repo_manager::RepoManager};

pub struct AutoFetchService {
    handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    /// 间隔秒数，0 表示禁用自动 fetch。
    interval_secs: Arc<Mutex<u64>>,
}

impl AutoFetchService {
    pub fn new() -> Self {
        Self {
            handle: Arc::new(Mutex::new(None)),
            interval_secs: Arc::new(Mutex::new(5 * 60)),
        }
    }

    pub fn start(&self, app: AppHandle) {
        let mut lock = self.handle.lock();
        if lock.is_some() {
            return;
        }
        let interval_secs = Arc::clone(&self.interval_secs);
        *lock = Some(Self::spawn_task(app, interval_secs));
    }

    /// 运行时更改自动 fetch 间隔（秒）。0 表示禁用。
    /// 会中止当前任务并以新间隔重新启动。
    pub fn set_interval(&self, secs: u64, app: AppHandle) {
        *self.interval_secs.lock() = secs;
        let mut lock = self.handle.lock();
        if let Some(old) = lock.take() {
            old.abort();
        }
        if secs == 0 {
            // 禁用，不重新启动
            return;
        }
        let interval_secs = Arc::clone(&self.interval_secs);
        *lock = Some(Self::spawn_task(app, interval_secs));
    }

    fn spawn_task(
        app: AppHandle,
        interval_secs: Arc<Mutex<u64>>,
    ) -> JoinHandle<()> {
        tauri::async_runtime::spawn(async move {
            loop {
                let secs = *interval_secs.lock();
                if secs == 0 {
                    // 禁用状态：等待再检查
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    continue;
                }
                tokio::time::sleep(Duration::from_secs(secs)).await;

                // 再次检查（sleep 期间可能被改为 0）
                if *interval_secs.lock() == 0 {
                    continue;
                }

                let repos = app.state::<RepoManager>().list_repos();
                for meta in repos {
                    match GitEngine::list_remotes(&meta.path) {
                        Ok(remotes) => {
                            for remote in &remotes {
                                if let Err(e) = GitEngine::fetch(&meta.path, remote) {
                                    log::warn!(
                                        "[auto_fetch] fetch failed for {} remote={}: {e}",
                                        meta.id, remote
                                    );
                                    let _ = app.emit(
                                        "repo://error",
                                        serde_json::json!({
                                            "repoId": meta.id,
                                            "msg": format!("Auto-fetch failed ({}): {e}", remote)
                                        }),
                                    );
                                }
                            }
                            let _ = app.emit("repo://remote-updated", &meta.id);
                        }
                        Err(e) => {
                            log::warn!(
                                "[auto_fetch] list_remotes failed for {}: {e}",
                                meta.id
                            );
                        }
                    }
                }
            }
        })
    }
}
