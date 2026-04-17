use tauri::State;

use crate::{
    git::{
        engine::GitEngine,
        error::GitError,
        types::{ConflictFile, MergeStrategy, RebaseTodoItem},
    },
    repo_manager::RepoManager,
};

// ── Merge ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn merge_branch(
    repo_id: String,
    source_branch: String,
    strategy: MergeStrategy,
    message: Option<String>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::merge_branch(&meta.path, &source_branch, strategy, message.as_deref())
}

#[tauri::command]
pub async fn merge_continue(
    repo_id: String,
    message: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::merge_continue(&meta.path, &message)
}

#[tauri::command]
pub async fn merge_abort(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::merge_abort(&meta.path)
}

// ── Rebase ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn rebase_plan(
    repo_id: String,
    upstream: String,
    onto: Option<String>,
    repo_manager: State<'_, RepoManager>,
) -> Result<Vec<RebaseTodoItem>, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::rebase_plan(&meta.path, &upstream, onto.as_deref())
}

#[tauri::command]
pub async fn rebase_start(
    repo_id: String,
    upstream: String,
    onto: Option<String>,
    todo: Option<Vec<RebaseTodoItem>>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::rebase_start(&meta.path, &upstream, onto.as_deref(), todo)
}

#[tauri::command]
pub async fn rebase_continue(
    repo_id: String,
    amended_message: Option<String>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::rebase_continue(&meta.path, amended_message.as_deref())
}

#[tauri::command]
pub async fn rebase_skip(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::rebase_skip(&meta.path)
}

#[tauri::command]
pub async fn rebase_abort(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::rebase_abort(&meta.path)
}

// ── Conflict ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_conflict_file(
    repo_id: String,
    file_path: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<ConflictFile, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::get_conflict_file(&meta.path, &file_path)
}

#[tauri::command]
pub async fn mark_conflict_resolved(
    repo_id: String,
    file_path: String,
    content: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::mark_conflict_resolved(&meta.path, &file_path, &content)
}

#[tauri::command]
pub async fn checkout_conflict_side(
    repo_id: String,
    file_path: String,
    side: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::checkout_conflict_side(&meta.path, &file_path, &side)
}
