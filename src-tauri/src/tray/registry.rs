use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use crate::git::types::RepoMeta;

use super::state::SharedWriter;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MenuEntry {
    pub(super) window_id: String,
    pub(super) label: String,
}

struct WindowRecord {
    window_id: String,
    pid: u32,
    active_repo: Option<RepoMeta>,
    writer: Option<SharedWriter>,
    is_local: bool,
    seq: u64,
}

pub(super) struct OwnerRegistry {
    windows: HashMap<String, WindowRecord>,
    next_seq: u64,
    last_active_window_id: Option<String>,
}

impl OwnerRegistry {
    pub(super) fn new() -> Self {
        Self {
            windows: HashMap::new(),
            next_seq: 1,
            last_active_window_id: None,
        }
    }

    pub(super) fn register_window(
        &mut self,
        window_id: String,
        pid: u32,
        active_repo: Option<RepoMeta>,
        writer: Option<SharedWriter>,
        is_local: bool,
    ) {
        let seq = self.next_seq;
        let record = self.windows.entry(window_id.clone()).or_insert_with(|| {
            self.next_seq += 1;
            WindowRecord {
                window_id: window_id.clone(),
                pid,
                active_repo: None,
                writer: None,
                is_local,
                seq,
            }
        });
        record.pid = pid;
        record.active_repo = active_repo;
        if writer.is_some() {
            record.writer = writer;
        }
        record.is_local = is_local;
        if record.active_repo.is_some() {
            self.last_active_window_id = Some(window_id);
        } else if self.last_active_window_id.as_deref() == Some(record.window_id.as_str()) {
            self.last_active_window_id = None;
        }
    }

    pub(super) fn update_active_repo(&mut self, window_id: &str, active_repo: Option<RepoMeta>) {
        if let Some(record) = self.windows.get_mut(window_id) {
            record.active_repo = active_repo;
            if record.active_repo.is_some() {
                self.last_active_window_id = Some(window_id.to_string());
            } else if self.last_active_window_id.as_deref() == Some(window_id) {
                self.last_active_window_id = None;
            }
        }
    }

    pub(super) fn remove_window(&mut self, window_id: &str) {
        self.windows.remove(window_id);
        if self.last_active_window_id.as_deref() == Some(window_id) {
            self.last_active_window_id = None;
        }
    }

    pub(super) fn has_windows(&self) -> bool {
        !self.windows.is_empty()
    }

    pub(super) fn writer_for(&self, window_id: &str) -> Option<SharedWriter> {
        self.windows
            .get(window_id)
            .and_then(|record| record.writer.as_ref().map(Arc::clone))
    }

    pub(super) fn remote_writers(&self) -> Vec<SharedWriter> {
        self.windows
            .values()
            .filter_map(|record| {
                (!record.is_local)
                    .then(|| record.writer.as_ref().map(Arc::clone))
                    .flatten()
            })
            .collect()
    }

    pub(super) fn preferred_window_id(&self) -> Option<String> {
        if let Some(id) = &self.last_active_window_id {
            if self
                .windows
                .get(id)
                .is_some_and(|record| record.active_repo.is_some())
            {
                return Some(id.clone());
            }
        }
        self.sorted_records()
            .into_iter()
            .find(|record| record.active_repo.is_some())
            .or_else(|| self.sorted_records().into_iter().next())
            .map(|record| record.window_id.clone())
    }

    pub(super) fn menu_entries(&self) -> Vec<MenuEntry> {
        let records = self
            .sorted_records()
            .into_iter()
            .filter(|record| record.active_repo.is_some())
            .collect::<Vec<_>>();

        let duplicate_names = duplicate_repo_names(&records);
        records
            .into_iter()
            .filter_map(|record| {
                let repo = record.active_repo.as_ref()?;
                let label = if duplicate_names.contains(&repo.name) {
                    format!("{} - {}", repo.name, repo.path)
                } else {
                    repo.name.clone()
                };
                Some(MenuEntry {
                    window_id: record.window_id.clone(),
                    label,
                })
            })
            .collect()
    }

    fn sorted_records(&self) -> Vec<&WindowRecord> {
        let mut records = self.windows.values().collect::<Vec<_>>();
        records.sort_by_key(|record| record.seq);
        records
    }
}

fn duplicate_repo_names(records: &[&WindowRecord]) -> HashSet<String> {
    let mut seen = HashSet::new();
    let mut duplicates = HashSet::new();
    for record in records {
        if let Some(repo) = &record.active_repo {
            if !seen.insert(repo.name.clone()) {
                duplicates.insert(repo.name.clone());
            }
        }
    }
    duplicates
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(id: &str, name: &str, path: &str) -> RepoMeta {
        RepoMeta {
            id: id.to_string(),
            name: name.to_string(),
            path: path.to_string(),
        }
    }

    #[test]
    fn registry_adds_updates_and_removes_windows() {
        let mut registry = OwnerRegistry::new();
        registry.register_window(
            "window-a".to_string(),
            1,
            Some(repo("repo-a", "alpha", "/repos/alpha")),
            None,
            true,
        );
        registry.register_window("window-b".to_string(), 2, None, None, false);

        assert_eq!(registry.menu_entries().len(), 1);

        registry.update_active_repo("window-b", Some(repo("repo-b", "beta", "/repos/beta")));
        assert_eq!(
            registry
                .menu_entries()
                .into_iter()
                .map(|entry| entry.label)
                .collect::<Vec<_>>(),
            vec!["alpha".to_string(), "beta".to_string()]
        );

        registry.remove_window("window-a");
        assert_eq!(
            registry.menu_entries(),
            vec![MenuEntry {
                window_id: "window-b".to_string(),
                label: "beta".to_string()
            }]
        );
    }

    #[test]
    fn registry_disambiguates_duplicate_repo_names() {
        let mut registry = OwnerRegistry::new();
        registry.register_window(
            "window-a".to_string(),
            1,
            Some(repo("repo-a", "app", "/work/a/app")),
            None,
            true,
        );
        registry.register_window(
            "window-b".to_string(),
            2,
            Some(repo("repo-b", "app", "/work/b/app")),
            None,
            false,
        );
        registry.register_window(
            "window-c".to_string(),
            3,
            Some(repo("repo-c", "docs", "/work/docs")),
            None,
            false,
        );

        let labels = registry
            .menu_entries()
            .into_iter()
            .map(|entry| entry.label)
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "app - /work/a/app".to_string(),
                "app - /work/b/app".to_string(),
                "docs".to_string()
            ]
        );
    }

    #[test]
    fn preferred_window_tracks_latest_active_window_and_disconnects() {
        let mut registry = OwnerRegistry::new();
        registry.register_window(
            "window-a".to_string(),
            1,
            Some(repo("repo-a", "alpha", "/repos/alpha")),
            None,
            true,
        );
        registry.register_window(
            "window-b".to_string(),
            2,
            Some(repo("repo-b", "beta", "/repos/beta")),
            None,
            false,
        );

        assert_eq!(registry.preferred_window_id().as_deref(), Some("window-b"));

        registry.remove_window("window-b");

        assert_eq!(registry.preferred_window_id().as_deref(), Some("window-a"));
    }
}
