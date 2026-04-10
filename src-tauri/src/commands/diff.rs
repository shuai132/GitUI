use tauri::State;

use crate::{
    git::{engine::GitEngine, error::GitError, types::FileDiff},
    repo_manager::RepoManager,
};

#[tauri::command]
pub async fn get_file_diff(
    repo_id: String,
    file_path: String,
    staged: bool,
    repo_manager: State<'_, RepoManager>,
) -> Result<FileDiff, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::get_file_diff(&meta.path, &file_path, staged)
}
