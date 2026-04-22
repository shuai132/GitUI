use parking_lot::Mutex;
use std::{sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter, Manager, async_runtime::JoinHandle};

use crate::{git::engine::GitEngine, repo_manager::RepoManager};

pub struct AutoFetchService {
    handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    /// 间隔秒数，0 表示禁用自动 fetch。
    interval_secs: Arc<Mutex<u64>>,
    /// 当前激活仓库的 id，None 表示无激活仓库（跳过 fetch）。
    active_repo_id: Arc<Mutex<Option<String>>>,
}

impl AutoFetchService {
    pub fn new() -> Self {
        Self {
            handle: Arc::new(Mutex::new(None)),
            interval_secs: Arc::new(Mutex::new(5 * 60)),
            active_repo_id: Arc::new(Mutex::new(None)),
        }
    }

    /// 前端切换激活仓库时调用，auto-fetch 只对该仓库生效。
    pub fn set_active_repo(&self, repo_id: Option<String>) {
        *self.active_repo_id.lock() = repo_id;
    }

    pub fn start(&self, app: AppHandle) {
        let mut lock = self.handle.lock();
        if lock.is_some() {
            return;
        }
        let interval_secs = Arc::clone(&self.interval_secs);
        let active_repo_id = Arc::clone(&self.active_repo_id);
        *lock = Some(Self::spawn_task(app, interval_secs, active_repo_id));
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
        let active_repo_id = Arc::clone(&self.active_repo_id);
        *lock = Some(Self::spawn_task(app, interval_secs, active_repo_id));
    }

    fn spawn_task(
        app: AppHandle,
        interval_secs: Arc<Mutex<u64>>,
        active_repo_id: Arc<Mutex<Option<String>>>,
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

                // 只 fetch 当前激活仓库，无激活仓库则跳过
                let target_id = active_repo_id.lock().clone();
                let Some(repo_id) = target_id else {
                    continue;
                };

                let meta = app.state::<RepoManager>().get_meta(&repo_id);
                let Some(meta) = meta else {
                    log::warn!("[auto_fetch] active repo {repo_id} not found in RepoManager");
                    continue;
                };

                match GitEngine::list_remotes(&meta.path) {
                    Ok(remotes) => {
                        for remote in &remotes {
                            if let Err(e) = GitEngine::fetch(&meta.path, &remote.name) {
                                log::warn!(
                                    "[auto_fetch] fetch failed for {} remote={}: {e}",
                                    meta.id, remote.name
                                );
                                let _ = app.emit(
                                    "repo://error",
                                    serde_json::json!({
                                        "repoId": meta.id,
                                        "msg": format!("Auto-fetch failed ({}): {e}", remote.name)
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
        })
    }
}
