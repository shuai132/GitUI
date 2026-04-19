use tauri::State;

use crate::{
    git::{engine::GitEngine, error::GitError},
    repo_manager::RepoManager,
};

#[tauri::command]
pub async fn create_commit(
    repo_id: String,
    message: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<String, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;

    if message.trim().is_empty() {
        return Err(GitError::OperationFailed(
            "Commit message cannot be empty".to_string(),
        ));
    }

    log::debug!("[create_commit] message_len={}", message.len());
    GitEngine::create_commit(&meta.path, &message)
}

#[tauri::command]
pub async fn checkout_commit(
    repo_id: String,
    oid: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::checkout_commit(&meta.path, &oid)
}

#[tauri::command]
pub async fn cherry_pick_commit(
    repo_id: String,
    oid: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::cherry_pick_commit(&meta.path, &oid)
}

#[tauri::command]
pub async fn revert_commit(
    repo_id: String,
    oid: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::revert_commit(&meta.path, &oid)
}

#[tauri::command]
pub async fn cherry_pick_continue(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::cherry_pick_continue(&meta.path)
}

#[tauri::command]
pub async fn cherry_pick_abort(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::cherry_pick_abort(&meta.path)
}

#[tauri::command]
pub async fn revert_continue(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::revert_continue(&meta.path)
}

#[tauri::command]
pub async fn revert_abort(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::revert_abort(&meta.path)
}

#[tauri::command]
pub async fn reset_to_commit(
    repo_id: String,
    oid: String,
    mode: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::reset_to_commit(&meta.path, &oid, &mode)
}

#[tauri::command]
pub async fn amend_commit(
    repo_id: String,
    message: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<String, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;

    if message.trim().is_empty() {
        return Err(GitError::OperationFailed(
            "Commit message cannot be empty".to_string(),
        ));
    }

    GitEngine::amend_commit(&meta.path, &message)
}

#[tauri::command]
pub async fn amend_commit_message(
    repo_id: String,
    message: String,
    author_time: Option<i64>,
    committer_time: Option<i64>,
    repo_manager: State<'_, RepoManager>,
) -> Result<String, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;

    if message.trim().is_empty() {
        return Err(GitError::OperationFailed(
            "Commit message cannot be empty".to_string(),
        ));
    }

    GitEngine::amend_commit_message(&meta.path, &message, author_time, committer_time)
}

#[tauri::command]
pub async fn create_tag(
    repo_id: String,
    name: String,
    oid: String,
    message: Option<String>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    if name.trim().is_empty() {
        return Err(GitError::OperationFailed(
            "标签名不能为空".to_string(),
        ));
    }
    GitEngine::create_tag(&meta.path, &name, &oid, message.as_deref())
}
