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
    
    if remote_name == "--all" {
        let remotes = GitEngine::list_remotes(&meta.path)?;
        for remote in remotes {
            let _ = GitEngine::fetch(&meta.path, &remote.name);
        }
        Ok(())
    } else {
        let result = GitEngine::fetch(&meta.path, &remote_name);
        log::debug!("[fetch_remote] result={result:?}");
        result
    }
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
    force: bool,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    log::debug!("[push_tag] remote={remote_name} tag={tag_name} force={force}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    let result = GitEngine::push_tag(&meta.path, &remote_name, &tag_name, force);
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
) -> Result<Vec<crate::git::types::RemoteInfo>, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::list_remotes(&meta.path)
}

#[tauri::command]
pub async fn add_remote(
    repo_id: String,
    name: String,
    url: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    log::debug!("[add_remote] name={name} url={url}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::add_remote(&meta.path, &name, &url)
}

#[tauri::command]
pub async fn remove_remote(
    repo_id: String,
    name: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    log::debug!("[remove_remote] name={name}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::remove_remote(&meta.path, &name)
}

#[tauri::command]
pub async fn edit_remote(
    repo_id: String,
    old_name: String,
    new_name: String,
    new_url: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    log::debug!("[edit_remote] old={old_name} new={new_name} url={new_url}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::edit_remote(&meta.path, &old_name, &new_name, &new_url)
}
