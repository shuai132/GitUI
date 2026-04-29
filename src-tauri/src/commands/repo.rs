use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use notify_debouncer_mini::DebounceEventResult;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::{
    auto_fetch::AutoFetchService,
    git::{engine::GitEngine, error::GitError, types::RepoMeta},
    repo_manager::RepoManager,
    watcher::{IgnoreFilter, WatcherService},
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
    let ignore_filter = Some(IgnoreFilter::build(watch_dir.clone()));
    let app_clone = app.clone();
    let repo_id_clone = repo_id.to_string();
    let kind_root = watch_dir.clone();

    watcher
        .watch_only(
            repo_id.to_string(),
            watch_dir,
            ignore_filter,
            move |result| {
                let payload = StatusChangedPayload {
                    repo_id: repo_id_clone.clone(),
                    kind: classify_status_change(&kind_root, &result),
                };
                let _ = app_clone.emit("repo://status-changed", payload);
            },
        )
        .map_err(|e| GitError::OperationFailed(format!("启动文件监听失败: {e}")))?;

    Ok(())
}

#[tauri::command]
pub async fn close_repo(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
    watcher: State<'_, WatcherService>,
) -> Result<(), GitError> {
    watcher.unwatch(&repo_id);
    repo_manager.remove_repo(&repo_id);
    Ok(())
}

#[tauri::command]
pub async fn set_active_repo(
    repo_id: Option<String>,
    app: AppHandle,
    repo_manager: State<'_, RepoManager>,
    watcher: State<'_, WatcherService>,
) -> Result<(), GitError> {
    match repo_id {
        Some(id) => {
            let meta = repo_manager
                .get_meta(&id)
                .ok_or_else(|| GitError::RepoNotOpen(id.clone()))?;
            watch_active_repo(&id, &meta.path, &app, &watcher)?;
            app.state::<AutoFetchService>().set_active_repo(Some(id));
        }
        None => {
            watcher.unwatch_all();
            app.state::<AutoFetchService>().set_active_repo(None);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn list_repos(repo_manager: State<'_, RepoManager>) -> Result<Vec<RepoMeta>, GitError> {
    Ok(repo_manager.list_repos())
}

#[tauri::command]
pub async fn validate_repo_path(path: String) -> Result<bool, GitError> {
    Ok(Path::new(&path).join(".git").exists() || GitEngine::open(&path).is_ok())
}

fn classify_status_change(root: &Path, result: &DebounceEventResult) -> StatusChangeKind {
    let Ok(events) = result else {
        return StatusChangeKind::OtherGit;
    };

    events
        .iter()
        .map(|event| classify_status_path(root, &event.path))
        .max_by_key(|kind| status_change_priority(*kind))
        .unwrap_or(StatusChangeKind::OtherGit)
}

fn classify_status_path(root: &Path, path: &Path) -> StatusChangeKind {
    let Ok(rel) = path.strip_prefix(root) else {
        return StatusChangeKind::OtherGit;
    };
    let mut components = rel.components().filter_map(|c| c.as_os_str().to_str());
    let Some(first) = components.next() else {
        return StatusChangeKind::OtherGit;
    };

    if first == ".gitmodules" {
        return StatusChangeKind::Config;
    }

    if first != ".git" {
        return StatusChangeKind::Worktree;
    }

    let Some(second) = components.next() else {
        return StatusChangeKind::OtherGit;
    };

    let git_name = second.strip_suffix(".lock").unwrap_or(second);
    match git_name {
        "index" => StatusChangeKind::Index,
        "config" => StatusChangeKind::Config,
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
    let last = trimmed
        .rsplit(|c: char| c == '/' || c == ':')
        .next()
        .unwrap_or("");
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

    let url_for_task = url.clone();
    let target_for_task = target_str.clone();
    let handle = tokio::task::spawn_blocking(move || {
        GitEngine::clone_repo(&url_for_task, &target_for_task, depth, recurse, on_progress)
    });

    match handle.await {
        Ok(Ok(workdir)) => Ok(workdir),
        Ok(Err(e)) => Err(e),
        Err(join_err) => Err(GitError::OperationFailed(format!(
            "clone task panicked: {}",
            join_err
        ))),
    }
}

#[tauri::command]
pub async fn init_repo(path: String) -> Result<String, GitError> {
    let path_for_task = path.clone();
    let handle =
        tokio::task::spawn_blocking(move || GitEngine::init_repo(&path_for_task).map(|_| ()));

    match handle.await {
        Ok(Ok(())) => Ok(path),
        Ok(Err(e)) => Err(e),
        Err(join_err) => Err(GitError::OperationFailed(format!(
            "init task panicked: {}",
            join_err
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_plain_worktree_path() {
        let root = Path::new("/repo");
        assert_eq!(
            classify_status_path(root, Path::new("/repo/src/main.rs")),
            StatusChangeKind::Worktree
        );
    }

    #[test]
    fn classifies_git_control_paths() {
        let root = Path::new("/repo");
        assert_eq!(
            classify_status_path(root, Path::new("/repo/.git/index.lock")),
            StatusChangeKind::Index
        );
        assert_eq!(
            classify_status_path(root, Path::new("/repo/.git/refs/heads/main")),
            StatusChangeKind::Refs
        );
        assert_eq!(
            classify_status_path(root, Path::new("/repo/.git/FETCH_HEAD")),
            StatusChangeKind::Refs
        );
        assert_eq!(
            classify_status_path(root, Path::new("/repo/.git/config")),
            StatusChangeKind::Config
        );
    }

    #[test]
    fn classifies_gitmodules_as_config() {
        let root = Path::new("/repo");
        assert_eq!(
            classify_status_path(root, Path::new("/repo/.gitmodules")),
            StatusChangeKind::Config
        );
    }
}
