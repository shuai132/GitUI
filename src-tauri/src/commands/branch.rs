use crate::git_tasks::{run_git, run_network};
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
    run_git(move || GitEngine::list_branches(&meta.path)).await
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
    run_git(move || {
        log::debug!("[create_branch] name={name} from_oid={from_oid:?}");
        GitEngine::create_branch(&meta.path, &name, from_oid.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn switch_branch(
    repo_id: String,
    name: String,
    force: bool,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    log::debug!("[switch_branch] name={name} force={force}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    run_git(move || GitEngine::switch_branch(&meta.path, &name, force)).await
}

#[tauri::command]
pub async fn delete_branch(
    repo_id: String,
    name: String,
    expected_oid: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    log::debug!("[delete_branch] name={name}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    run_git(move || GitEngine::delete_branch(&meta.path, &name, &expected_oid)).await
}

#[tauri::command]
pub async fn delete_remote_branch(
    repo_id: String,
    remote_name: String,
    branch_name: String,
    expected_oid: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    log::debug!("[delete_remote_branch] remote={remote_name} branch={branch_name}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    run_network(move || {
        GitEngine::delete_remote_branch(&meta.path, &remote_name, &branch_name, &expected_oid)
    })
    .await
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
    run_git(move || {
        GitEngine::checkout_remote_branch(&meta.path, &remote_branch, &local_name, track)
    })
    .await
}
