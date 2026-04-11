use std::path::Path;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    git::{engine::GitEngine, error::GitError, types::RepoMeta},
    repo_manager::RepoManager,
    watcher::WatcherService,
};

#[tauri::command]
pub async fn open_repo(
    path: String,
    app: AppHandle,
    repo_manager: State<'_, RepoManager>,
    watcher: State<'_, WatcherService>,
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

    // Set up file watcher for working directory (includes .git/)
    // Watching only .git/ misses edits to tracked files in the work tree.
    let watch_dir = workdir.to_path_buf();
    let app_clone = app.clone();
    let repo_id_clone = id.clone();

    let _ = watcher.watch(
        id.clone(),
        watch_dir,
        move |_result| {
            let _ = app_clone.emit("repo://status-changed", &repo_id_clone);
        },
    );

    Ok(meta)
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
pub async fn list_repos(
    repo_manager: State<'_, RepoManager>,
) -> Result<Vec<RepoMeta>, GitError> {
    Ok(repo_manager.list_repos())
}

#[tauri::command]
pub async fn validate_repo_path(path: String) -> Result<bool, GitError> {
    Ok(Path::new(&path).join(".git").exists()
        || GitEngine::open(&path).is_ok())
}
