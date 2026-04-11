use std::process::Command;
use tauri::State;

use crate::{
    git::{engine::GitEngine, error::GitError},
    repo_manager::RepoManager,
};

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
