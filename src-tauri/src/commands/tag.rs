use tauri::State;

use crate::{
    git::{engine::GitEngine, error::GitError, types::TagInfo},
    repo_manager::RepoManager,
};

#[tauri::command]
pub async fn list_tags(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<Vec<TagInfo>, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::list_tags(&meta.path)
}

#[tauri::command]
pub async fn delete_tag(
    repo_id: String,
    name: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    log::debug!("[delete_tag] name={name}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::delete_tag(&meta.path, &name)
}

#[tauri::command]
pub async fn list_remote_tags(
    repo_id: String,
    remote_name: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<Vec<TagInfo>, GitError> {
    log::debug!("[list_remote_tags] remote={remote_name}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::list_remote_tags(&meta.path, &remote_name)
}
