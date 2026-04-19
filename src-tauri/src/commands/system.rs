use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

use crate::{
    auto_fetch::AutoFetchService,
    git::{engine::GitEngine, error::GitError, types::{BuildInfo, ReflogEntry}},
    repo_manager::RepoManager,
};

/// 启动命令行参数里带的 `--open-repo <path>`，由 `open_in_new_window` 拉起子实例时注入。
/// 子进程前端在 `loadPersisted` 完成后调用 `consume_startup_repo` 取走并置空，使之只生效一次。
#[derive(Default)]
pub struct StartupRepo(pub Mutex<Option<String>>);

/// 在仓库目录打开系统默认终端。
/// - macOS: `open -a <terminal_app> <path>`，`terminal_app` 由前端从设置传入（默认 `Terminal`）
/// - Linux: 依次尝试 x-terminal-emulator / gnome-terminal / konsole / xterm（忽略 `terminal_app`）
/// - Windows: `cmd /C start cmd /K cd /D <path>`（忽略 `terminal_app`）
#[tauri::command]
pub async fn open_terminal(
    repo_id: String,
    terminal_app: Option<String>,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    let path = meta.path.clone();

    #[cfg(target_os = "macos")]
    {
        let app = terminal_app
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Terminal");
        Command::new("open")
            .args(["-a", app, &path])
            .spawn()
            .map_err(|e| GitError::OperationFailed(format!("打开终端失败: {}", e)))?;
        return Ok(());
    }

    // 非 macOS 平台忽略 terminal_app，走原自动探测逻辑
    #[cfg(not(target_os = "macos"))]
    let _ = terminal_app;

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

/// 从 HEAD reflog 中移除让 `oid` 从 unreachable 视图消失所需的所有 entry（剥链）。
/// 具体语义见 `GitEngine::drop_unreachable_commit`：包含目标自身以及所有把目标作为祖先的 reflog 入口。
/// 返回实际删除的 entry 数；配合 `preview_drop_unreachable_commit` 可在执行前预览数量。
#[tauri::command]
pub async fn drop_unreachable_commit(
    repo_id: String,
    oid: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<usize, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::drop_unreachable_commit(&meta.path, &oid)
}

/// `drop_unreachable_commit` 的 dry-run：返回将被移除的 reflog entry 数，不改 reflog。
/// 前端在二次确认对话框显示"将同时移除 N 条 reflog 引用"。
#[tauri::command]
pub async fn preview_drop_unreachable_commit(
    repo_id: String,
    oid: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<usize, GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::preview_drop_unreachable_commit(&meta.path, &oid)
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

/// 在系统文件管理器中高亮显示指定文件（接收绝对文件路径）。
/// macOS: `open -R <path>`  Windows: `explorer /select,<path>`  Linux: xdg-open 父目录
#[tauri::command]
pub async fn reveal_file(path: String) -> Result<(), GitError> {
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
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| GitError::OperationFailed(format!("打开资源管理器失败: {}", e)))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(path);
        Command::new("xdg-open")
            .arg(&parent)
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

/// 用系统默认应用打开指定文件（通常是默认编辑器）。
#[tauri::command]
pub async fn open_file_in_editor(
    path: String,
    app: tauri::AppHandle,
) -> Result<(), GitError> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| GitError::OperationFailed(format!("打开文件失败: {}", e)))
}

/// 在指定目录打开系统终端（直接接受绝对目录路径，不依赖仓库 ID）。
#[tauri::command]
pub async fn open_terminal_here(
    dir_path: String,
    terminal_app: Option<String>,
) -> Result<(), GitError> {
    let path = dir_path;

    #[cfg(target_os = "macos")]
    {
        let app = terminal_app
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Terminal");
        Command::new("open")
            .args(["-a", app, &path])
            .spawn()
            .map_err(|e| GitError::OperationFailed(format!("打开终端失败: {}", e)))?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    let _ = terminal_app;

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

/// 将指定文件路径追加到仓库 .gitignore（幂等，已存在则跳过）。
#[tauri::command]
pub async fn add_to_gitignore(
    repo_id: String,
    file_path: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    use std::io::Write;
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    let gitignore_path = std::path::PathBuf::from(&meta.path).join(".gitignore");
    let existing = std::fs::read_to_string(&gitignore_path).unwrap_or_default();
    if existing.lines().any(|l| l == file_path) {
        return Ok(());
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&gitignore_path)
        .map_err(|e| GitError::OperationFailed(format!("打开 .gitignore 失败: {}", e)))?;
    if !existing.is_empty() && !existing.ends_with('\n') {
        writeln!(f)
            .map_err(|e| GitError::OperationFailed(format!("写入 .gitignore 失败: {}", e)))?;
    }
    writeln!(f, "{}", file_path)
        .map_err(|e| GitError::OperationFailed(format!("写入 .gitignore 失败: {}", e)))?;
    Ok(())
}

/// 从指定提交签出单个文件到工作目录（不修改 HEAD 或暂存区）。
#[tauri::command]
pub async fn checkout_file_at_commit(
    repo_id: String,
    sha: String,
    file_path: String,
    repo_manager: State<'_, RepoManager>,
) -> Result<(), GitError> {
    let meta = repo_manager
        .get_meta(&repo_id)
        .ok_or_else(|| GitError::RepoNotOpen(repo_id.clone()))?;
    GitEngine::checkout_file_at_commit(&meta.path, &sha, &file_path)
}

/// 设置自动 fetch 间隔（秒），0 表示禁用自动 fetch。
/// 会中止当前后台任务并以新间隔重新启动。
#[tauri::command]
pub async fn set_auto_fetch_interval(
    secs: u64,
    app: AppHandle,
) -> Result<(), GitError> {
    app.state::<AutoFetchService>().set_interval(secs, app.clone());
    Ok(())
}

/// 前端切换激活仓库时通知后端，auto-fetch 只对该仓库生效。
/// repo_id 为 None 表示当前无激活仓库（应跳过 fetch）。
#[tauri::command]
pub async fn set_active_repo_for_fetch(
    repo_id: Option<String>,
    app: AppHandle,
) -> Result<(), GitError> {
    app.state::<AutoFetchService>().set_active_repo(repo_id);
    Ok(())
}

/// 返回应用版本（`Cargo.toml` 中的 `version`）和编译时注入的短 commit hash。
/// 用于「关于」面板等需要展示精确 build 标识的场景。
#[tauri::command]
pub fn get_build_info() -> BuildInfo {
    BuildInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        git_hash: option_env!("GIT_HASH").map(str::to_string),
    }
}

/// 枚举系统已安装的字体族名称，返回按字母排序的去重列表。
/// macOS 使用 CoreText，Windows 使用 DirectWrite，Linux 使用 fontconfig。
#[tauri::command]
pub fn list_system_fonts() -> Vec<String> {
    use font_kit::source::SystemSource;
    let source = SystemSource::new();
    let mut families = source.all_families().unwrap_or_default();
    families.sort_unstable_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    families.dedup();
    families
}
