//! 应用内终端：基于 `portable-pty` 的跨平台 PTY 会话管理。
//!
//! 每个 session 启动一个子 shell（macOS/Linux 的 `$SHELL`，Windows 的 `powershell.exe`），
//! 读循环在独立线程里把 PTY master 输出编码 base64 后通过事件 `terminal://data`
//! 推给前端；子进程退出时发 `terminal://exit`。
//!
//! 前端的键盘输入通过 `terminal_write` 命令回写到 master；resize 通过 `terminal_resize`
//! 同步到 PTY。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::git::error::GitError;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

pub struct TerminalManager {
    sessions: Mutex<HashMap<String, Session>>,
}

#[derive(Serialize, Clone)]
struct DataPayload {
    session_id: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct ExitPayload {
    session_id: String,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// 启动一个 PTY 子 shell，`cwd` 作为工作目录。返回 session_id。
    pub fn spawn(
        &self,
        app: AppHandle,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<String, GitError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| GitError::OperationFailed(format!("openpty 失败: {}", e)))?;

        // 选 shell
        let shell = default_shell();
        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(cwd);
        // 大多 shell 依赖 TERM
        cmd.env("TERM", "xterm-256color");
        // 把父进程的 PATH / HOME 等继承过去
        for (k, v) in std::env::vars() {
            // CommandBuilder 默认不继承环境，需要手动塞
            cmd.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| GitError::OperationFailed(format!("启动 shell 失败: {}", e)))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| GitError::OperationFailed(format!("取 pty writer 失败: {}", e)))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| GitError::OperationFailed(format!("clone pty reader 失败: {}", e)))?;

        let session_id = uuid::Uuid::new_v4().to_string();

        // 读取线程：PTY → 前端
        {
            let session_id = session_id.clone();
            let app = app.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let encoded = B64.encode(&buf[..n]);
                            let _ = app.emit(
                                "terminal://data",
                                DataPayload {
                                    session_id: session_id.clone(),
                                    data: encoded,
                                },
                            );
                        }
                        Err(_) => break,
                    }
                }
                let _ = app.emit("terminal://exit", ExitPayload { session_id });
            });
        }

        let mut map = self
            .sessions
            .lock()
            .map_err(|e| GitError::OperationFailed(format!("terminal state poisoned: {}", e)))?;
        map.insert(
            session_id.clone(),
            Session {
                master: pair.master,
                writer,
                child,
            },
        );

        Ok(session_id)
    }

    pub fn write(&self, session_id: &str, data_b64: &str) -> Result<(), GitError> {
        let bytes = B64
            .decode(data_b64)
            .map_err(|e| GitError::OperationFailed(format!("base64 decode: {}", e)))?;
        let mut map = self
            .sessions
            .lock()
            .map_err(|e| GitError::OperationFailed(format!("terminal state poisoned: {}", e)))?;
        let session = map
            .get_mut(session_id)
            .ok_or_else(|| GitError::OperationFailed(format!("session not found: {}", session_id)))?;
        session
            .writer
            .write_all(&bytes)
            .map_err(|e| GitError::Io(e.to_string()))?;
        session.writer.flush().map_err(|e| GitError::Io(e.to_string()))
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), GitError> {
        let map = self
            .sessions
            .lock()
            .map_err(|e| GitError::OperationFailed(format!("terminal state poisoned: {}", e)))?;
        let session = map
            .get(session_id)
            .ok_or_else(|| GitError::OperationFailed(format!("session not found: {}", session_id)))?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| GitError::OperationFailed(format!("resize 失败: {}", e)))
    }

    pub fn close(&self, session_id: &str) -> Result<(), GitError> {
        let mut map = self
            .sessions
            .lock()
            .map_err(|e| GitError::OperationFailed(format!("terminal state poisoned: {}", e)))?;
        if let Some(mut session) = map.remove(session_id) {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
        Ok(())
    }
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(unix)]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

#[cfg(windows)]
fn default_shell() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
}
