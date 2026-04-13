use tauri::{AppHandle, State};

use crate::{
    git::error::GitError,
    repo_manager::RepoManager,
    terminal::TerminalManager,
};

/// 在当前仓库目录下启动一个 PTY shell 会话。返回 session_id。
#[tauri::command]
pub async fn terminal_spawn(
    repo_id: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    repo_manager: State<'_, RepoManager>,
    terminal: State<'_, TerminalManager>,
) -> Result<String, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    terminal.spawn(app, &meta.path, cols.max(1), rows.max(1))
}

/// 把键盘输入（base64 编码的字节）写入 PTY。
#[tauri::command]
pub async fn terminal_write(
    session_id: String,
    data: String,
    terminal: State<'_, TerminalManager>,
) -> Result<(), GitError> {
    terminal.write(&session_id, &data)
}

/// 同步 PTY 尺寸（fit-addon 回传）。
#[tauri::command]
pub async fn terminal_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    terminal: State<'_, TerminalManager>,
) -> Result<(), GitError> {
    terminal.resize(&session_id, cols.max(1), rows.max(1))
}

/// kill 子 shell 并移除会话。
#[tauri::command]
pub async fn terminal_close(
    session_id: String,
    terminal: State<'_, TerminalManager>,
) -> Result<(), GitError> {
    terminal.close(&session_id)
}
