use tauri::State;

use crate::{
    git::{engine::GitEngine, error::GitError, types::BranchInfo},
    repo_manager::RepoManager,
};

#[tauri::command]
pub async fn list_branches(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<Vec<BranchInfo>, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::list_branches(&meta.path)
}

#[tauri::command]
pub async fn create_branch(
    repo_id: String,
    name: String,
    from_oid: Option<String>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::create_branch(&meta.path, &name, from_oid.as_deref())
}

#[tauri::command]
pub async fn switch_branch(
    repo_id: String,
    name: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::switch_branch(&meta.path, &name)
}

#[tauri::command]
pub async fn delete_branch(
    repo_id: String,
    name: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::delete_branch(&meta.path, &name)
}

#[tauri::command]
pub async fn checkout_remote_branch(
    repo_id: String,
    remote_branch: String,
    local_name: String,
    track: bool,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::checkout_remote_branch(&meta.path, &remote_branch, &local_name, track)
}
