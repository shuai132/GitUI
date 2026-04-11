use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::git::types::{RepoMeta, WorkspaceStatus};

#[derive(Debug, Clone)]
pub struct RepoCacheEntry {
    pub meta: RepoMeta,
    pub status: Option<WorkspaceStatus>,
    pub dirty: bool,
}

pub type RepoStore = Arc<Mutex<HashMap<String, RepoCacheEntry>>>;

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
        let mut repos = self.repos.lock().unwrap();
        repos.insert(
            meta.id.clone(),
            RepoCacheEntry {
                meta,
                status: None,
                dirty: true,
            },
        );
    }

    pub fn remove_repo(&self, repo_id: &str) {
        let mut repos = self.repos.lock().unwrap();
        repos.remove(repo_id);
    }

    pub fn list_repos(&self) -> Vec<RepoMeta> {
        let repos = self.repos.lock().unwrap();
        repos.values().map(|e| e.meta.clone()).collect()
    }

    pub fn get_meta(&self, repo_id: &str) -> Option<RepoMeta> {
        let repos = self.repos.lock().unwrap();
        repos.get(repo_id).map(|e| e.meta.clone())
    }

    #[allow(dead_code)]
    pub fn mark_dirty(&self, repo_id: &str) {
        let mut repos = self.repos.lock().unwrap();
        if let Some(entry) = repos.get_mut(repo_id) {
            entry.dirty = true;
        }
    }

    pub fn update_status(&self, repo_id: &str, status: WorkspaceStatus) {
        let mut repos = self.repos.lock().unwrap();
        if let Some(entry) = repos.get_mut(repo_id) {
            entry.status = Some(status);
            entry.dirty = false;
        }
    }

    #[allow(dead_code)]
    pub fn get_cached_status(&self, repo_id: &str) -> Option<WorkspaceStatus> {
        let repos = self.repos.lock().unwrap();
        repos.get(repo_id).and_then(|e| e.status.clone())
    }
}
