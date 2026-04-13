use std::process::Command;
use std::sync::Mutex;
use tauri::State;

use crate::{
    git::{engine::GitEngine, error::GitError, types::ReflogEntry},
    repo_manager::RepoManager,
};

/// 启动命令行参数里带的 `--open-repo <path>`，由 `open_in_new_window` 拉起子实例时注入。
/// 子进程前端在 `loadPersisted` 完成后调用 `consume_startup_repo` 取走并置空，使之只生效一次。
#[derive(Default)]
pub struct StartupRepo(pub Mutex<Option<String>>);

/// 在仓库目录打开系统默认终端。
/// - macOS: `open -a Terminal <path>`
/// - Linux: 依次尝试 x-terminal-emulator / gnome-terminal / konsole / xterm
/// - Windows: `cmd /C start cmd /K cd /D <path>`
#[tauri::command]
pub async fn open_terminal(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    let path = meta.path.clone();

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal", &path])
            .spawn()
            .map_err(|e| GitError::OperationFailed(format!("打开终端失败: {}", e)))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let candidates: &[(&str, Vec<String>)] = &[
            (
                "x-terminal-emulator",
                vec![format!("--working-directory={}", path)],
            ),
            (
                "gnome-terminal",
                vec![format!("--working-directory={}", path)],
            ),
            ("konsole", vec!["--workdir".to_string(), path.clone()]),
            ("xterm", vec!["-e".to_string(), format!("cd {}; $SHELL", path)]),
        ];
        for (bin, args) in candidates {
            if Command::new(bin).args(args).spawn().is_ok() {
                return Ok(());
            }
        }
        return Err(GitError::OperationFailed(
            "未找到可用的终端程序".to_string(),
        ));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "cmd", "/K", "cd", "/D", &path])
            .spawn()
            .map_err(|e| GitError::OperationFailed(format!("打开终端失败: {}", e)))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = path;
        Err(GitError::OperationFailed(
            "当前平台不支持打开终端".to_string(),
        ))
    }
}

/// 丢弃所有工作区变更 + untracked 文件（不动 HEAD，不删 gitignore 的文件）
#[tauri::command]
pub async fn discard_all_changes(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::discard_all_changes(&meta.path)
}

/// 读取 HEAD reflog，返回最新的 500 条记录
#[tauri::command]
pub async fn get_reflog(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<Vec<ReflogEntry>, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::get_reflog(&meta.path, 500)
}

/// 执行 git gc
#[tauri::command]
pub async fn run_gc(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<String, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::run_gc(&meta.path)
}

/// 在一个新的 GitUI 实例（新进程）里打开指定仓库。
///
/// - macOS: 找到当前 `.app` bundle，用 `open -n -a <bundle> --args --open-repo <path>`
///   起一个全新实例（`-n` 允许同一 bundle 多开）
/// - Linux / Windows / 开发模式：直接 `current_exe --open-repo <path>`
///
/// 新进程的 `RepoManager` 是独立的，不会和当前进程共享 watcher 或内存态，隔离干净。
/// 副作用：第二个进程会再注册一个 tray 图标，暂未做 single-instance 去重。
#[tauri::command]
pub async fn open_in_new_window(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    let path = meta.path.clone();

    let current_exe = std::env::current_exe().map_err(|e| {
        GitError::OperationFailed(format!("定位当前可执行文件失败: {}", e))
    })?;

    #[cfg(target_os = "macos")]
    {
        use std::path::PathBuf;
        // 向上查找 .app bundle
        let mut bundle = current_exe.clone();
        let mut found_bundle: Option<PathBuf> = None;
        loop {
            if bundle.extension().and_then(|e| e.to_str()) == Some("app") {
                found_bundle = Some(bundle.clone());
                break;
            }
            if !bundle.pop() {
                break;
            }
        }

        if let Some(b) = found_bundle {
            Command::new("open")
                .args(["-n", "-a"])
                .arg(&b)
                .args(["--args", "--open-repo"])
                .arg(&path)
                .spawn()
                .map_err(|e| GitError::OperationFailed(format!("启动新窗口失败: {}", e)))?;
            return Ok(());
        }
        // 开发模式：直接拉起二进制
        Command::new(&current_exe)
            .args(["--open-repo"])
            .arg(&path)
            .spawn()
            .map_err(|e| GitError::OperationFailed(format!("启动新窗口失败: {}", e)))?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Command::new(&current_exe)
            .args(["--open-repo"])
            .arg(&path)
            .spawn()
            .map_err(|e| GitError::OperationFailed(format!("启动新窗口失败: {}", e)))?;
        Ok(())
    }
}

/// 在系统文件管理器中显示该仓库目录（reveal in Finder / Explorer）。
#[tauri::command]
pub async fn reveal_in_file_manager(
    repo_id: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    let path = meta.path.clone();

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| GitError::OperationFailed(format!("打开 Finder 失败: {}", e)))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| GitError::OperationFailed(format!("打开资源管理器失败: {}", e)))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| GitError::OperationFailed(format!("打开文件管理器失败: {}", e)))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = path;
        Err(GitError::OperationFailed(
            "当前平台不支持在文件管理器中显示".to_string(),
        ))
    }
}

/// 返回并清空本进程启动时通过 `--open-repo` 带入的仓库路径。
/// 前端在 `loadPersisted` 之后调用，只生效一次。
#[tauri::command]
pub async fn consume_startup_repo(
    startup: State<'_, StartupRepo>,
) -> Result<Option<String>, GitError> {
    Ok(startup.0.lock().map_err(|e| {
        GitError::OperationFailed(format!("startup state poisoned: {}", e))
    })?.take())
}

/// 丢弃单个文件的工作区变更
#[tauri::command]
pub async fn discard_file(
    repo_id: String,
    file_path: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::discard_file(&meta.path, &file_path)
}
