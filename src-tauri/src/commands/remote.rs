use tauri::State;

use crate::{
    git::{engine::GitEngine, error::GitError},
    repo_manager::RepoManager,
};

#[tauri::command]
pub async fn fetch_remote(
    repo_id: String,
    remote_name: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    log::debug!("[fetch_remote] remote={remote_name}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    let result = GitEngine::fetch(&meta.path, &remote_name);
    log::debug!("[fetch_remote] result={result:?}");
    result
}

#[tauri::command]
pub async fn push_branch(
    repo_id: String,
    remote_name: String,
    branch_name: String,
    mode: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    log::debug!("[push_branch] remote={remote_name} branch={branch_name} mode={mode}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    let result = GitEngine::push(&meta.path, &remote_name, &branch_name, &mode);
    log::debug!("[push_branch] result={result:?}");
    result
}

#[tauri::command]
pub async fn push_tag(
    repo_id: String,
    remote_name: String,
    tag_name: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    log::debug!("[push_tag] remote={remote_name} tag={tag_name}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    let result = GitEngine::push_tag(&meta.path, &remote_name, &tag_name);
    log::debug!("[push_tag] result={result:?}");
    result
}

#[tauri::command]
pub async fn pull_branch(
    repo_id: String,
    remote_name: String,
    branch_name: String,
    mode: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    log::debug!("[pull_branch] remote={remote_name} branch={branch_name} mode={mode}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    let result = GitEngine::pull(&meta.path, &remote_name, &branch_name, &mode);
    log::debug!("[pull_branch] result={result:?}");
    result
}

#[tauri::command]
pub async fn list_remotes(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<Vec<String>, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::list_remotes(&meta.path)
}
