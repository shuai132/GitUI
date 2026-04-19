mod auto_fetch;
mod commands;
mod git;
mod logger;
#[cfg(target_os = "macos")]
mod menu;
mod repo_manager;
mod terminal;
mod tray;
mod watcher;

use commands::{
    branch::*, commit::*, diff::*, log::*, merge_rebase::*, remote::*, repo::*, stash::*,
    status::*, submodule::*, system::*, tag::*, terminal::*,
};
use commands::system::StartupRepo;
use auto_fetch::AutoFetchService;
use repo_manager::RepoManager;
use terminal::TerminalManager;
use tauri::{Manager, WindowEvent};
// RunEvent::Reopen 仅在 macOS 的 tauri 枚举里存在（Dock 图标点击事件），
// 在 Linux / Windows 上该变体不存在，需要 cfg 隔离 use 和匹配逻辑。
#[cfg(target_os = "macos")]
use tauri::RunEvent;
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
        .manage(AutoFetchService::new())
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
            get_repo_state,
            // Merge / Rebase / Conflict
            merge_branch,
            merge_continue,
            merge_abort,
            rebase_plan,
            rebase_start,
            rebase_continue,
            rebase_skip,
            rebase_abort,
            get_conflict_file,
            mark_conflict_resolved,
            checkout_conflict_side,
            // Commit
            create_commit,
            amend_commit,
            amend_commit_message,
            checkout_commit,
            cherry_pick_commit,
            cherry_pick_continue,
            cherry_pick_abort,
            revert_commit,
            revert_continue,
            revert_abort,
            reset_to_commit,
            create_tag,
            // Log
            get_log,
            get_commit_detail,
            get_file_log,
            // Diff
            get_file_diff,
            get_blob_bytes,
            read_worktree_file,
            get_file_diff_at_commit,
            get_file_blame,
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
            drop_unreachable_commit,
            preview_drop_unreachable_commit,
            reveal_file,
            open_file_in_editor,
             open_terminal_here,
             add_to_gitignore,
             checkout_file_at_commit,
             get_build_info,
             set_auto_fetch_interval,
             set_active_repo_for_fetch,
            // Terminal
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_close,
        ])
        .setup(|app| {
            logger::init();
            logger::set_app_handle(app.handle().clone());
            log::info!("GitUI started");
            tray::setup_tray(&app.handle())?;
            #[cfg(target_os = "macos")]
            menu::setup_menu(&app.handle())?;
            app.state::<AutoFetchService>().start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide to tray instead of quitting
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // macOS: 点击 Dock 图标唤回隐藏窗口。其他平台无该事件，整段跳过。
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = _event {
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
