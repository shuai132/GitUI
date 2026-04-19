use tauri::State;

use crate::{
    git::{engine::GitEngine, error::GitError, types::SubmoduleInfo},
    repo_manager::RepoManager,
};

#[tauri::command]
pub async fn list_submodules(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<Vec<SubmoduleInfo>, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::list_submodules(&meta.path)
}

#[tauri::command]
pub async fn init_submodule(
    repo_id: String,
    name: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::init_submodule(&meta.path, &name)
}

#[tauri::command]
pub async fn update_submodule(
    repo_id: String,
    name: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::update_submodule(&meta.path, &name)
}

#[tauri::command]
pub async fn set_submodule_url(
    repo_id: String,
    name: String,
    url: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::set_submodule_url(&meta.path, &name, &url)
}

#[tauri::command]
pub async fn submodule_workdir(
    repo_id: String,
    name: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<String, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::submodule_workdir(&meta.path, &name)
}

#[tauri::command]
pub async fn deinit_submodule(
    repo_id: String,
    name: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::deinit_submodule(&meta.path, &name)
}

#[tauri::command]
pub async fn add_submodule(
    repo_id: String,
    url: String,
    path: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    log::debug!("[add_submodule] url={url} path={path}");
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::add_submodule(&meta.path, &url, &path)
}
