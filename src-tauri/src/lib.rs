mod commands;
mod git;
mod repo_manager;
mod tray;
mod watcher;

use commands::{branch::*, commit::*, diff::*, log::*, remote::*, repo::*, status::*};
use repo_manager::RepoManager;
use tauri::WindowEvent;
use watcher::WatcherService;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(RepoManager::new())
        .manage(WatcherService::new())
        .invoke_handler(tauri::generate_handler![
            // Repo
            open_repo,
            close_repo,
            list_repos,
            validate_repo_path,
            // Status
            get_status,
            stage_file,
            unstage_file,
            stage_all,
            unstage_all,
            // Commit
            create_commit,
            checkout_commit,
            cherry_pick_commit,
            revert_commit,
            reset_to_commit,
            create_tag,
            // Log
            get_log,
            get_commit_detail,
            // Diff
            get_file_diff,
            // Branch
            list_branches,
            create_branch,
            switch_branch,
            delete_branch,
            checkout_remote_branch,
            // Remote
            fetch_remote,
            push_branch,
            pull_branch,
            list_remotes,
        ])
        .setup(|app| {
            tray::setup_tray(&app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide to tray instead of quitting
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
