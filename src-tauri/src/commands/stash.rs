use tauri::State;

use crate::{
    git::{engine::GitEngine, error::GitError, types::StashEntry},
    repo_manager::RepoManager,
};

#[tauri::command]
pub async fn stash_push(
    repo_id: String,
    message: Option<String>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::stash_push(&meta.path, message.as_deref())
}

#[tauri::command]
pub async fn stash_pop(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::stash_pop(&meta.path)
}

#[tauri::command]
pub async fn stash_list(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<Vec<StashEntry>, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::stash_list(&meta.path)
}
