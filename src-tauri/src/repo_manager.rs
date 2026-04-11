use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::git::types::RepoMeta;

/// 仓库注册表：id ↔ RepoMeta 的 O(1) 查找。
///
/// 不存储 WorkspaceStatus / dirty —— 渲染状态由前端 Pinia 承担，单一事实来源。
/// 如果以后要做后端增量推送，重新设计协议，而不是复活这个缓存。
pub type RepoStore = Arc<Mutex<HashMap<String, RepoMeta>>>;

#[derive(Clone)]
pub struct RepoManager {
    pub repos: RepoStore,
}

impl RepoManager {
    pub fn new() -> Self {
        Self {
            repos: Arc::new(Mutex::new(HashMap::new())),
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
}
