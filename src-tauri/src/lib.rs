mod commands;
mod git;
mod logger;
mod repo_manager;
mod tray;
mod watcher;

use commands::{
    branch::*, commit::*, diff::*, log::*, remote::*, repo::*, stash::*, status::*, submodule::*,
    system::*,
};
use repo_manager::RepoManager;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, WindowEvent};
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
            amend_commit,
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
            // Submodule
            list_submodules,
            init_submodule,
            update_submodule,
            set_submodule_url,
            submodule_workdir,
            deinit_submodule,
            // Stash
            stash_push,
            stash_pop,
            stash_list,
            // System
            open_terminal,
            discard_all_changes,
            discard_file,
            get_reflog,
            run_gc,
        ])
        .menu(|app| {
            // App submenu: 用自定义 About 替代系统默认的 About
            let about = MenuItem::with_id(app, "about", "关于 GitUI", true, None::<&str>)?;
            let app_submenu = Submenu::with_items(
                app,
                "GitUI",
                true,
                &[
                    &about,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, Some("隐藏 GitUI"))?,
                    &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
                    &PredefinedMenuItem::show_all(app, Some("显示全部"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, Some("退出 GitUI"))?,
                ],
            )?;

            // Edit submenu: 保留剪切/复制/粘贴等标准操作
            let edit_submenu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;

            // Window submenu
            let window_submenu = Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::fullscreen(app, None)?,
                ],
            )?;

            Menu::with_items(app, &[&app_submenu, &edit_submenu, &window_submenu])
        })
        .on_menu_event(|app, event| {
            if event.id.as_ref() == "about" {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("show-about", ());
                }
            }
        })
        .setup(|app| {
            logger::init();
            logger::set_app_handle(app.handle().clone());
            log::info!("GitUI started");
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
