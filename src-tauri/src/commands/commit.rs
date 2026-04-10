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

    GitEngine::create_commit(&meta.path, &message)
}
