use tauri::State;

use crate::{
    git::{engine::GitEngine, error::GitError},
    repo_manager::RepoManager,
};

#[tauri::command]
pub async fn create_commit(
    repo_id: String,
    message: String,
    expected_head: Option<String>,
    expected_head_ref: String,
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
    GitEngine::create_commit(
        &meta.path,
        &message,
        expected_head.as_deref(),
        &expected_head_ref,
    )
}

#[tauri::command]
pub async fn checkout_commit(
    repo_id: String,
    oid: String,
    expected_head: Option<String>,
    expected_head_ref: Option<String>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::checkout_commit(
        &meta.path,
        &oid,
        expected_head.as_deref(),
        expected_head_ref.as_deref(),
    )
}

#[tauri::command]
pub async fn cherry_pick_commit(
    repo_id: String,
    oid: String,
    expected_head: Option<String>,
    expected_head_ref: Option<String>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::cherry_pick_commit(
        &meta.path,
        &oid,
        expected_head.as_deref(),
        expected_head_ref.as_deref(),
    )
}

#[tauri::command]
pub async fn revert_commit(
    repo_id: String,
    oid: String,
    expected_head: Option<String>,
    expected_head_ref: Option<String>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::revert_commit(
        &meta.path,
        &oid,
        expected_head.as_deref(),
        expected_head_ref.as_deref(),
    )
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
    expected_head: Option<String>,
    expected_head_ref: Option<String>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::reset_to_commit(
        &meta.path,
        &oid,
        &mode,
        expected_head.as_deref(),
        expected_head_ref.as_deref(),
    )
}

#[tauri::command]
pub async fn undo_last_commit(
    repo_id: String,
    expected_head: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<String, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::undo_last_commit(&meta.path, &expected_head)
}

#[tauri::command]
pub async fn amend_commit(
    repo_id: String,
    message: String,
    expected_head: String,
    expected_head_ref: String,
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

    GitEngine::amend_commit(&meta.path, &message, &expected_head, &expected_head_ref)
}

#[tauri::command]
pub async fn amend_commit_message(
    repo_id: String,
    message: String,
    author_time: Option<i64>,
    committer_time: Option<i64>,
    author_name: Option<String>,
    author_email: Option<String>,
    expected_head: String,
    expected_head_ref: String,
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

    GitEngine::amend_commit_message(
        &meta.path,
        &message,
        author_time,
        committer_time,
        author_name.as_deref(),
        author_email.as_deref(),
        &expected_head,
        &expected_head_ref,
    )
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
        return Err(GitError::OperationFailed("标签名不能为空".to_string()));
    }
    GitEngine::create_tag(&meta.path, &name, &oid, message.as_deref())
}
