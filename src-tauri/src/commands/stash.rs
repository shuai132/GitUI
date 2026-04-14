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
    index: Option<u32>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::stash_pop(&meta.path, index.unwrap_or(0) as usize)
}

#[tauri::command]
pub async fn stash_apply(
    repo_id: String,
    index: u32,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::stash_apply(&meta.path, index as usize)
}

#[tauri::command]
pub async fn stash_drop(
    repo_id: String,
    index: u32,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::stash_drop(&meta.path, index as usize)
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
