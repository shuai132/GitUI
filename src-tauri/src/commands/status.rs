use tauri::State;

use crate::{
    git::{engine::GitEngine, error::GitError, types::WorkspaceStatus},
    repo_manager::RepoManager,
};

#[tauri::command]
pub async fn get_status(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<WorkspaceStatus, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;

    let status = GitEngine::get_status(&meta.path)?;
    repo_manager.update_status(&repo_id, status.clone());
    Ok(status)
}

#[tauri::command]
pub async fn stage_file(
    repo_id: String,
    file_path: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::stage_file(&meta.path, &file_path)
}

#[tauri::command]
pub async fn unstage_file(
    repo_id: String,
    file_path: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::unstage_file(&meta.path, &file_path)
}

#[tauri::command]
pub async fn stage_all(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::stage_all(&meta.path)
}

#[tauri::command]
pub async fn unstage_all(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::unstage_all(&meta.path)
}
