use tauri::State;

use crate::{
    git::{
        engine::GitEngine,
        error::GitError,
        types::{BlobData, DocumentText, DocumentTextSource, FileBlame, FileDiff},
    },
    repo_manager::RepoManager,
};

#[tauri::command]
pub async fn get_file_diff(
    repo_id: String,
    file_path: String,
    staged: bool,
    ignore_whitespace: bool,
    repo_manager: State<'_, RepoManager>,
) -> Result<FileDiff, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::get_file_diff(&meta.path, &file_path, staged, ignore_whitespace)
}

#[tauri::command]
pub async fn get_blob_bytes(
    repo_id: String,
    oid: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<BlobData, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::get_blob_bytes(&meta.path, &oid)
}

#[tauri::command]
pub async fn read_worktree_file(
    repo_id: String,
    rel_path: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<BlobData, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::read_worktree_file(&meta.path, &rel_path)
}

#[tauri::command]
pub async fn extract_document_text(
    repo_id: String,
    source: DocumentTextSource,
    repo_manager: State<'_, RepoManager>,
) -> Result<DocumentText, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::extract_document_text(&meta.path, &source)
}

#[tauri::command]
pub async fn get_file_diff_at_commit(
    repo_id: String,
    file_path: String,
    old_file_path: Option<String>,
    oid: String,
    ignore_whitespace: bool,
    repo_manager: State<'_, RepoManager>,
) -> Result<FileDiff, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::get_file_diff_at_commit(
        &meta.path,
        &file_path,
        old_file_path.as_deref(),
        &oid,
        ignore_whitespace,
    )
}

#[tauri::command]
pub async fn get_file_blame(
    repo_id: String,
    file_path: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<FileBlame, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::get_file_blame(&meta.path, &file_path)
}
