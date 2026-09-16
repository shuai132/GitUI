use crate::git_tasks::run_git;
use tauri::State;

use crate::{
    git::{
        engine::GitEngine,
        error::GitError,
        types::{RepoState, WorkspaceStatus},
    },
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
    run_git(move || GitEngine::get_status(&meta.path)).await
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
    run_git(move || GitEngine::stage_file(&meta.path, &file_path)).await
}

#[tauri::command]
pub async fn stage_files(
    repo_id: String,
    file_paths: Vec<String>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    run_git(move || GitEngine::stage_files(&meta.path, &file_paths)).await
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
    run_git(move || GitEngine::unstage_file(&meta.path, &file_path)).await
}

#[tauri::command]
pub async fn unstage_files(
    repo_id: String,
    file_paths: Vec<String>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    run_git(move || GitEngine::unstage_files(&meta.path, &file_paths)).await
}

#[tauri::command]
pub async fn stage_all(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    run_git(move || GitEngine::stage_all(&meta.path)).await
}

#[tauri::command]
pub async fn unstage_all(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    run_git(move || GitEngine::unstage_all(&meta.path)).await
}

#[tauri::command]
pub async fn get_repo_state(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<RepoState, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    run_git(move || GitEngine::get_repo_state(&meta.path)).await
}

#[tauri::command]
pub async fn apply_patch(
    repo_id: String,
    patch_text: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    run_git(move || GitEngine::apply_patch(&meta.path, &patch_text)).await
}

#[tauri::command]
pub async fn apply_patch_to_index(
    repo_id: String,
    patch_text: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    run_git(move || GitEngine::apply_patch_to_index(&meta.path, &patch_text)).await
}

#[tauri::command]
pub async fn apply_patch_to_workdir_and_index(
    repo_id: String,
    patch_text: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    run_git(move || GitEngine::apply_patch_to_workdir_and_index(&meta.path, &patch_text)).await
}
