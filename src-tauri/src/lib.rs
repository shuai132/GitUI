mod commands;
mod git;
mod logger;
mod repo_manager;
mod terminal;
mod tray;
mod watcher;

use commands::{
    branch::*, commit::*, diff::*, log::*, remote::*, repo::*, stash::*, status::*, submodule::*,
    system::*, tag::*, terminal::*,
};
use commands::system::StartupRepo;
use repo_manager::RepoManager;
use terminal::TerminalManager;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, WindowEvent};
use watcher::WatcherService;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 解析 `--open-repo <path>`：由新窗口子进程启动时注入，前端在 loadPersisted
    // 之后会调 consume_startup_repo 取走该值并激活对应仓库。
    let startup_repo = {
        let args: Vec<String> = std::env::args().collect();
        args.windows(2)
            .find(|w| w[0] == "--open-repo")
            .map(|w| w[1].clone())
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .manage(RepoManager::new())
        .manage(WatcherService::new())
        .manage(TerminalManager::new())
        .manage(StartupRepo(std::sync::Mutex::new(startup_repo)))
        .invoke_handler(tauri::generate_handler![
            // Repo
            open_repo,
            close_repo,
            list_repos,
            validate_repo_path,
            clone_repo,
            init_repo,
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
            get_blob_bytes,
            read_worktree_file,
            // Branch
            list_branches,
            create_branch,
            switch_branch,
            delete_branch,
            checkout_remote_branch,
            // Tag
            list_tags,
            delete_tag,
            list_remote_tags,
            // Remote
            fetch_remote,
            push_branch,
            push_tag,
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
            stash_apply,
            stash_drop,
            stash_list,
            // System
            open_terminal,
            open_in_new_window,
            reveal_in_file_manager,
            consume_startup_repo,
            discard_all_changes,
            discard_file,
            get_reflog,
            run_gc,
            // Terminal
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_close,
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
