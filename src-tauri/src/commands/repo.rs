use crate::git_tasks::{run_git, run_network};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::{
    auto_fetch::AutoFetchService,
    git::{engine::GitEngine, error::GitError, types::RepoMeta},
    repo_manager::RepoManager,
    tray::TrayCoordinator,
    watcher::{IgnoreFilter, WatchEventResult, WatchPaths, WatcherService},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum StatusChangeKind {
    Worktree,
    Index,
    Refs,
    Config,
    OtherGit,
}

#[derive(Debug, Clone, Serialize)]
struct StatusChangedPayload {
    repo_id: String,
    kind: StatusChangeKind,
}

#[tauri::command]
pub async fn open_repo(
    path: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<RepoMeta, GitError> {
    let repo_manager = repo_manager.inner().clone();
    run_git(move || {
        // Validate it's a git repo
        let repo = GitEngine::open(&path)?;
        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::InvalidPath("Bare repos not supported".to_string()))?;

        let name = workdir
            .file_name()
            .unwrap_or(workdir.as_os_str())
            .to_string_lossy()
            .to_string();

        let id = Uuid::new_v4().to_string();
        let meta = RepoMeta {
            id: id.clone(),
            path: path.clone(),
            name,
        };

        repo_manager.add_repo(meta.clone());

        Ok(meta)
    })
    .await
}

fn watch_active_repo(
    repo_id: &str,
    path: &str,
    app: &AppHandle,
    watcher: &WatcherService,
) -> Result<(), GitError> {
    let repo = GitEngine::open(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::InvalidPath("Bare repos not supported".to_string()))?;

    // 监控整个工作目录否则会漏掉 tracked 文件的外部编辑；
    // 代价是 node_modules / target 等目录也会触发大量事件——
    // 用 IgnoreFilter 按 Git ignore 规则对未跟踪路径做前置过滤。
    let watch_dir = workdir.to_path_buf();
    let ignore_filter = IgnoreFilter::build(watch_dir.clone());
    let app_clone = app.clone();
    let repo_id_clone = repo_id.to_string();
    let watch_paths = ignore_filter.paths().clone();

    watcher
        .watch_only(
            repo_id.to_string(),
            watch_dir,
            Some(ignore_filter),
            move |result| {
                if let Err(err) = &result {
                    log::warn!("[watcher] repo={} error={err}", repo_id_clone);
                }
                let payload = StatusChangedPayload {
                    repo_id: repo_id_clone.clone(),
                    kind: classify_status_change(&watch_paths, &result),
                };
                log::debug!(
                    "[watcher] notify repo={} kind={:?}",
                    repo_id_clone,
                    payload.kind
                );
                if let Err(err) = app_clone.emit("repo://status-changed", payload) {
                    log::warn!("[watcher] repo={} emit failed: {err}", repo_id_clone);
                }
            },
        )
        .map_err(|e| GitError::OperationFailed(format!("启动文件监听失败: {e}")))?;

    Ok(())
}

#[tauri::command]
pub async fn close_repo(
    repo_id: String,
    next_active_repo_id: Option<String>,
    generation: u64,
    app: AppHandle,
    repo_manager: State<'_, RepoManager>,
    watcher: State<'_, WatcherService>,
) -> Result<(), GitError> {
    let repo_manager = repo_manager.inner().clone();
    let watcher = watcher.inner().clone();
    run_git(move || {
        let _active_guard = repo_manager.active_sync_lock();
        let coordinator = app.state::<TrayCoordinator>();
        if let Some(meta) = repo_manager.get_meta(&repo_id) {
            GitEngine::clear_log_cache(&meta.path);
        }
        if coordinator.is_local_window_closed() {
            repo_manager.remove_repo(&repo_id);
            watcher.unwatch_all();
            app.state::<AutoFetchService>().set_active_repo(None);
            repo_manager.clear_active_runtime();
            coordinator.update_active_repo(None);
            return Ok(());
        }

        let snapshot = repo_manager.active_snapshot();
        let was_active = snapshot.repo_id.as_deref() == Some(repo_id.as_str());
        let accepts_generation = repo_manager.accepts_generation(generation);

        let next_active_meta = if accepts_generation && was_active {
            match next_active_repo_id.as_deref() {
                Some(next_id) if next_id != repo_id => Some(
                    repo_manager
                        .get_meta(next_id)
                        .ok_or_else(|| GitError::RepoNotOpen(next_id.to_string()))?,
                ),
                Some(_) => {
                    return Err(GitError::OperationFailed(
                        "next active repo cannot be the closed repo".to_string(),
                    ));
                }
                None => None,
            }
        } else {
            None
        };

        repo_manager.remove_repo(&repo_id);

        if was_active {
            if accepts_generation {
                match next_active_meta {
                    Some(meta) => {
                        watch_active_repo(&meta.id, &meta.path, &app, &watcher)?;
                        app.state::<AutoFetchService>()
                            .set_active_repo(Some(meta.id.clone()));
                        repo_manager.set_active_state(Some(meta.id.clone()), generation);
                        coordinator.update_active_repo(Some(meta.clone()));
                    }
                    None => {
                        watcher.unwatch_all();
                        app.state::<AutoFetchService>().set_active_repo(None);
                        repo_manager.set_active_state(None, generation);
                        coordinator.update_active_repo(None);
                    }
                }
            } else {
                watcher.unwatch_all();
                app.state::<AutoFetchService>().set_active_repo(None);
                repo_manager.clear_active_runtime();
                coordinator.update_active_repo(None);
            }
        } else {
            watcher.unwatch(&repo_id);
            if accepts_generation {
                repo_manager.set_active_state(snapshot.repo_id, generation);
            }
        }

        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn set_active_repo(
    repo_id: Option<String>,
    generation: u64,
    app: AppHandle,
    repo_manager: State<'_, RepoManager>,
    watcher: State<'_, WatcherService>,
) -> Result<(), GitError> {
    let repo_manager = repo_manager.inner().clone();
    let watcher = watcher.inner().clone();
    run_git(move || {
        let _active_guard = repo_manager.active_sync_lock();
        let coordinator = app.state::<TrayCoordinator>();
        if coordinator.is_local_window_closed() {
            watcher.unwatch_all();
            app.state::<AutoFetchService>().set_active_repo(None);
            repo_manager.clear_active_runtime();
            coordinator.update_active_repo(None);
            return Ok(());
        }

        if !repo_manager.accepts_generation(generation) {
            log::debug!(
                "[repo] ignored stale set_active_repo generation={} current={}",
                generation,
                repo_manager.active_snapshot().generation
            );
            return Ok(());
        }

        match repo_id {
            Some(id) => {
                let meta = repo_manager
                    .get_meta(&id)
                    .ok_or_else(|| GitError::RepoNotOpen(id.clone()))?;
                watch_active_repo(&id, &meta.path, &app, &watcher)?;
                app.state::<AutoFetchService>().set_active_repo(Some(id));
                repo_manager.set_active_state(Some(meta.id.clone()), generation);
                coordinator.update_active_repo(Some(meta.clone()));
            }
            None => {
                watcher.unwatch_all();
                app.state::<AutoFetchService>().set_active_repo(None);
                repo_manager.set_active_state(None, generation);
                coordinator.update_active_repo(None);
            }
        }

        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn list_repos(repo_manager: State<'_, RepoManager>) -> Result<Vec<RepoMeta>, GitError> {
    Ok(repo_manager.list_repos())
}

#[tauri::command]
pub async fn validate_repo_path(path: String) -> Result<bool, GitError> {
    run_git(move || Ok(Path::new(&path).join(".git").exists() || GitEngine::open(&path).is_ok()))
        .await
}

fn classify_status_change(roots: &WatchPaths, result: &WatchEventResult) -> StatusChangeKind {
    let Ok(batch) = result else {
        return StatusChangeKind::OtherGit;
    };
    if batch.needs_rescan {
        return StatusChangeKind::OtherGit;
    }

    batch
        .paths
        .iter()
        .map(|path| classify_status_path(roots, path))
        .reduce(|combined, next| match (combined, next) {
            // 单个 kind 必须覆盖整批所需的数据域；Refs 不包含配置 / 子模块刷新。
            (StatusChangeKind::Config, StatusChangeKind::Refs)
            | (StatusChangeKind::Refs, StatusChangeKind::Config) => StatusChangeKind::OtherGit,
            _ if status_change_priority(next) > status_change_priority(combined) => next,
            _ => combined,
        })
        .unwrap_or(StatusChangeKind::OtherGit)
}

fn classify_status_path(roots: &WatchPaths, path: &Path) -> StatusChangeKind {
    let Some(rel) = roots.metadata_relative(path) else {
        return match roots.worktree_relative(path) {
            Some(rel) if rel == Path::new(".gitmodules") => StatusChangeKind::Config,
            Some(rel) if !rel.as_os_str().is_empty() => StatusChangeKind::Worktree,
            _ => StatusChangeKind::OtherGit,
        };
    };
    let Some(name) = rel.components().next().and_then(|c| c.as_os_str().to_str()) else {
        return StatusChangeKind::OtherGit;
    };

    let git_name = name.strip_suffix(".lock").unwrap_or(name);
    match git_name {
        "index" => StatusChangeKind::Index,
        "config" | "config.worktree" => StatusChangeKind::Config,
        "refs" | "logs" | "HEAD" | "FETCH_HEAD" | "ORIG_HEAD" | "MERGE_HEAD" | "MERGE_MSG"
        | "REBASE_HEAD" | "CHERRY_PICK_HEAD" | "REVERT_HEAD" | "packed-refs" => {
            StatusChangeKind::Refs
        }
        _ => StatusChangeKind::OtherGit,
    }
}

fn status_change_priority(kind: StatusChangeKind) -> u8 {
    match kind {
        StatusChangeKind::Worktree => 0,
        StatusChangeKind::Index => 1,
        StatusChangeKind::Config => 2,
        StatusChangeKind::Refs => 3,
        StatusChangeKind::OtherGit => 4,
    }
}

// ── Clone / Init ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneOptions {
    pub url: String,
    pub parent_dir: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub depth: Option<i32>,
    #[serde(default)]
    pub recurse_submodules: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeOptions {
    pub path: String,
    pub branch_name: String,
    #[serde(default)]
    pub start_point: Option<String>,
    #[serde(default)]
    pub start_point_is_remote: bool,
    pub expected_start_oid: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CloneProgressPayload {
    pub op: &'static str, // "clone"
    pub stage: String,    // "receiving" / "indexing" / "checkout" / "sideband"
    pub progress: u32,    // 0..=100
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// 从 URL 推导默认本地目录名：
/// - 截取最后一段（/ 或 : 之后）
/// - 去掉 `.git` 后缀
/// - 落空时返回 "repo"
fn infer_dir_name_from_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    let last = trimmed.rsplit(['/', ':']).next().unwrap_or("");
    let stripped = last.strip_suffix(".git").unwrap_or(last);
    if stripped.is_empty() {
        "repo".to_string()
    } else {
        stripped.to_string()
    }
}

fn is_dir_empty(p: &Path) -> bool {
    match std::fs::read_dir(p) {
        Ok(mut iter) => iter.next().is_none(),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn clone_repo(opts: CloneOptions, app: AppHandle) -> Result<String, GitError> {
    // 基本校验
    let url = opts.url.trim().to_string();
    if url.is_empty() {
        return Err(GitError::InvalidPath("clone url is empty".to_string()));
    }
    let parent = PathBuf::from(&opts.parent_dir);
    if !parent.is_dir() {
        return Err(GitError::InvalidPath(format!(
            "parent directory not found: {}",
            parent.display()
        )));
    }
    let name = opts
        .name
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| infer_dir_name_from_url(&url));

    let target = parent.join(&name);
    if target.exists() && !is_dir_empty(&target) {
        return Err(GitError::OperationFailed(format!(
            "target directory already exists and is not empty: {}",
            target.display()
        )));
    }

    let target_str = target.to_string_lossy().to_string();
    let depth = opts.depth;
    let recurse = opts.recurse_submodules;

    // 进度节流：最多每 100ms 或跨越 1% 才 emit 一次（sideband 消息始终放行，
    // 因为它是稀疏的服务器提示，不会构成风暴）
    let last_emit: Arc<Mutex<(Instant, String, u32)>> =
        Arc::new(Mutex::new((Instant::now(), String::new(), u32::MAX)));
    let app_for_cb = app.clone();

    let on_progress = move |stage: &str, progress: u32, message: Option<String>| {
        let is_sideband = stage == "sideband";
        if !is_sideband {
            let mut guard = last_emit.lock().unwrap();
            let (ref last_time, ref last_stage, last_pct) = *guard;
            let now = Instant::now();
            let stage_changed = last_stage != stage;
            let pct_jumped = progress.abs_diff(last_pct) >= 1;
            let time_ok = now.duration_since(*last_time).as_millis() >= 100;
            if !(stage_changed || (pct_jumped && time_ok) || progress == 100) {
                return;
            }
            *guard = (now, stage.to_string(), progress);
        }

        let payload = CloneProgressPayload {
            op: "clone",
            stage: stage.to_string(),
            progress,
            message,
        };
        let _ = app_for_cb.emit("repo://operation-progress", payload);
    };

    run_network(move || GitEngine::clone_repo(&url, &target_str, depth, recurse, on_progress)).await
}

#[tauri::command]
pub async fn init_repo(path: String) -> Result<String, GitError> {
    run_git(move || {
        GitEngine::init_repo(&path)?;
        Ok(path)
    })
    .await
}

#[tauri::command]
pub async fn create_worktree(
    repo_id: String,
    opts: CreateWorktreeOptions,
    repo_manager: State<'_, RepoManager>,
) -> Result<String, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    run_git(move || {
        GitEngine::create_worktree(
            &meta.path,
            &opts.path,
            &opts.branch_name,
            opts.start_point.as_deref(),
            opts.start_point_is_remote,
            &opts.expected_start_oid,
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_plain_worktree_path() {
        let root = Path::new("/repo");
        let roots = WatchPaths::new(root, &root.join(".git"), &root.join(".git"));
        assert_eq!(
            classify_status_path(&roots, Path::new("/repo/src/main.rs")),
            StatusChangeKind::Worktree
        );
    }

    #[test]
    fn classifies_rescan_batch_as_conservative_git_change() {
        let root = Path::new("/repo");
        let roots = WatchPaths::new(root, &root.join(".git"), &root.join(".git"));
        let batch: WatchEventResult = Ok(crate::watcher::WatchEventBatch {
            paths: Vec::new(),
            needs_rescan: true,
        });

        assert_eq!(
            classify_status_change(&roots, &batch),
            StatusChangeKind::OtherGit
        );
    }

    #[test]
    fn mixed_config_and_refs_batch_preserves_both_refresh_domains() {
        for paths in [
            vec![".git/config", ".git/refs/heads/main"],
            vec![".git/refs/heads/main", ".gitmodules"],
        ] {
            let root = Path::new("/repo");
            let roots = WatchPaths::new(root, &root.join(".git"), &root.join(".git"));
            let batch = Ok(crate::watcher::WatchEventBatch {
                paths: paths.into_iter().map(|path| root.join(path)).collect(),
                needs_rescan: false,
            });
            assert_eq!(
                classify_status_change(&roots, &batch),
                StatusChangeKind::OtherGit
            );
        }
    }

    #[test]
    fn classifies_git_control_paths() {
        let root = Path::new("/repo");
        let roots = WatchPaths::new(root, &root.join(".git"), &root.join(".git"));
        assert_eq!(
            classify_status_path(&roots, Path::new("/repo/.git/index.lock")),
            StatusChangeKind::Index
        );
        assert_eq!(
            classify_status_path(&roots, Path::new("/repo/.git/refs/heads/main")),
            StatusChangeKind::Refs
        );
        assert_eq!(
            classify_status_path(&roots, Path::new("/repo/.git/FETCH_HEAD")),
            StatusChangeKind::Refs
        );
        assert_eq!(
            classify_status_path(&roots, Path::new("/repo/.git/config")),
            StatusChangeKind::Config
        );
    }

    #[test]
    fn classifies_external_worktree_and_submodule_metadata() {
        let root = Path::new("/linked");
        let private = Path::new("/main/.git/worktrees/linked");
        let common = Path::new("/main/.git");
        let paths = WatchPaths::new(root, private, common);
        for (path, expected) in [
            (private.join("index.lock"), StatusChangeKind::Index),
            (private.join("HEAD"), StatusChangeKind::Refs),
            (private.join("config.worktree"), StatusChangeKind::Config),
            (common.join("refs/heads/deleted"), StatusChangeKind::Refs),
            (common.join("packed-refs.lock"), StatusChangeKind::Refs),
            (common.join("config"), StatusChangeKind::Config),
            (root.join(".git"), StatusChangeKind::OtherGit),
            (root.join("src/main.rs"), StatusChangeKind::Worktree),
        ] {
            assert_eq!(classify_status_path(&paths, &path), expected);
        }
        let module = Path::new("/parent/.git/modules/child");
        let paths = WatchPaths::new(Path::new("/parent/child"), module, module);
        assert_eq!(
            classify_status_path(&paths, &module.join("index")),
            StatusChangeKind::Index
        );
        assert_eq!(
            classify_status_path(&paths, &module.join("HEAD")),
            StatusChangeKind::Refs
        );
    }

    #[test]
    fn classifies_gitmodules_as_config() {
        let root = Path::new("/repo");
        let roots = WatchPaths::new(root, &root.join(".git"), &root.join(".git"));
        assert_eq!(
            classify_status_path(&roots, Path::new("/repo/.gitmodules")),
            StatusChangeKind::Config
        );
    }
}
