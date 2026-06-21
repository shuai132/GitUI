use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::git::types::RepoMeta;

/// 仓库注册表：id ↔ RepoMeta 的 O(1) 查找。
///
/// 不存储 WorkspaceStatus / dirty —— 渲染状态由前端 Pinia 承担，单一事实来源。
/// 如果以后要做后端增量推送，重新设计协议，而不是复活这个缓存。
pub type RepoStore = Arc<Mutex<HashMap<String, RepoMeta>>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveRepoSnapshot {
    pub repo_id: Option<String>,
    pub generation: u64,
}

#[derive(Debug, Default)]
struct ActiveRepoState {
    repo_id: Option<String>,
    generation: u64,
}

#[derive(Clone)]
pub struct RepoManager {
    pub repos: RepoStore,
    active: Arc<Mutex<ActiveRepoState>>,
    active_sync: Arc<Mutex<()>>,
}

impl RepoManager {
    pub fn new() -> Self {
        Self {
            repos: Arc::new(Mutex::new(HashMap::new())),
            active: Arc::new(Mutex::new(ActiveRepoState::default())),
            active_sync: Arc::new(Mutex::new(())),
        }
    }

    pub fn add_repo(&self, meta: RepoMeta) {
        let mut repos = self.repos.lock();
        repos.insert(meta.id.clone(), meta);
    }

    pub fn remove_repo(&self, repo_id: &str) {
        let mut repos = self.repos.lock();
        repos.remove(repo_id);
    }

    pub fn list_repos(&self) -> Vec<RepoMeta> {
        let repos = self.repos.lock();
        repos.values().cloned().collect()
    }

    pub fn get_meta(&self, repo_id: &str) -> Option<RepoMeta> {
        let repos = self.repos.lock();
        repos.get(repo_id).cloned()
    }

    pub fn active_sync_lock(&self) -> parking_lot::MutexGuard<'_, ()> {
        self.active_sync.lock()
    }

    pub fn active_snapshot(&self) -> ActiveRepoSnapshot {
        let active = self.active.lock();
        ActiveRepoSnapshot {
            repo_id: active.repo_id.clone(),
            generation: active.generation,
        }
    }

    pub fn accepts_generation(&self, generation: u64) -> bool {
        generation >= self.active.lock().generation
    }

    pub fn set_active_state(&self, repo_id: Option<String>, generation: u64) {
        let mut active = self.active.lock();
        active.repo_id = repo_id;
        active.generation = generation;
    }

    pub fn clear_active_runtime(&self) {
        self.active.lock().repo_id = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generation_rejects_older_active_updates() {
        let manager = RepoManager::new();

        assert!(manager.accepts_generation(1));
        manager.set_active_state(Some("repo-a".to_string()), 2);

        assert!(!manager.accepts_generation(1));
        assert!(manager.accepts_generation(2));
        assert!(manager.accepts_generation(3));
    }

    #[test]
    fn clear_active_runtime_keeps_latest_generation() {
        let manager = RepoManager::new();
        manager.set_active_state(Some("repo-a".to_string()), 7);

        manager.clear_active_runtime();

        assert_eq!(
            manager.active_snapshot(),
            ActiveRepoSnapshot {
                repo_id: None,
                generation: 7
            }
        );
    }
}
