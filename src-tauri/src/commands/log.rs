use tauri::State;

use crate::{
    git::{engine::GitEngine, error::GitError, types::{CommitDetail, CommitInfo, LogPage}},
    repo_manager::RepoManager,
};

#[tauri::command]
pub async fn get_log(
    repo_id: String,
    offset: usize,
    limit: usize,
    include_unreachable: bool,
    include_stashes: bool,
    repo_manager: State<'_, RepoManager>,
) -> Result<LogPage, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;

    let limit = limit.min(500); // cap at 500 per page
    GitEngine::get_log(&meta.path, offset, limit, include_unreachable, include_stashes)
}

#[tauri::command]
pub async fn get_commit_summary(
    repo_id: String,
    oid: String,
    include_stats: bool,
    repo_manager: State<'_, RepoManager>,
) -> Result<CommitDetail, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::get_commit_summary(&meta.path, &oid, include_stats)
}

#[tauri::command]
pub async fn get_commit_detail(
    repo_id: String,
    oid: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<CommitDetail, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::get_commit_detail(&meta.path, &oid)
}

#[tauri::command]
pub async fn get_file_log(
    repo_id: String,
    file_path: String,
    offset: usize,
    limit: usize,
    repo_manager: State<'_, RepoManager>,
) -> Result<Vec<CommitInfo>, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    let limit = limit.min(200);
    GitEngine::get_file_log(&meta.path, &file_path, offset, limit)
}
