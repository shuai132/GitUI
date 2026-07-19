//! SSH 远端 fallback：网络操作检测到 SSH URL 时，走系统 `git` 命令而不是 libgit2。
//!
//! 背景：git2 捆绑的 libssh2 在 Windows 上用 WinCNG 后端，支持的 host key 算法不全，
//! 现代 Git 服务端（GitHub 等）常报 `failed to set hostkey preference`。复用系统
//! OpenSSH + ssh-agent + `~/.ssh/config`（即命令行 git 已经能跑的那套配置）绕开问题。
//! HTTPS 仍走 libgit2 + 系统 credential helper，不变。

use std::{
    env,
    ffi::{OsStr, OsString},
    path::PathBuf,
    process::{Command, Stdio},
    sync::OnceLock,
};

#[cfg(windows)]
const GITUI_SSH_PROXY_ENV: &str = "GITUI_SSH_PROXY";
#[cfg(windows)]
const GITUI_SSH_PROXY_VALUE: &str = "1";

#[cfg(unix)]
static SHELLOUT_PATH: OnceLock<Option<OsString>> = OnceLock::new();

use crate::git::{
    engine::GitEngine,
    error::{GitError, GitResult},
};
use crate::process::configure_background_command;

/// 判断一个远端 URL 是否应走 SSH 分支。
///
/// 识别两种形式：
/// - `ssh://[user@]host[:port]/path`
/// - scp-like：`user@host:path`（冒号左侧不含 `/`，否则会和 `C:\...` 冲突）
///
/// 显式排除 `http(s)://`、`git://`、`file://`、本地路径。
pub fn is_ssh_url(url: &str) -> bool {
    let u = url.trim();
    if u.is_empty() {
        return false;
    }
    if u.starts_with("ssh://") {
        return true;
    }
    if u.starts_with("http://")
        || u.starts_with("https://")
        || u.starts_with("git://")
        || u.starts_with("file://")
    {
        return false;
    }
    // scp-like: 必须含 '@' 和 ':'，且 ':' 在 '@' 之后；':' 左侧（host 部分）不含 '/'
    if let Some(at_idx) = u.find('@') {
        if let Some(colon_idx) = u[at_idx + 1..].find(':') {
            let host = &u[at_idx + 1..at_idx + 1 + colon_idx];
            if !host.is_empty() && !host.contains('/') {
                return true;
            }
        }
    }
    false
}

/// 读取指定 remote 的 URL。
pub fn get_remote_url(path: &str, remote_name: &str) -> GitResult<String> {
    let repo = GitEngine::open(path)?;
    let remote = repo.find_remote(remote_name)?;
    remote
        .url()
        .map(|s| s.to_string())
        .ok_or_else(|| GitError::OperationFailed(format!("remote '{remote_name}' has no URL")))
}

/// 如果当前进程是被 Git 作为 Windows SSH proxy 启动，则转发到真实 `ssh.exe`。
///
/// 返回 `Some(exit_code)` 表示已经完成 proxy 工作，调用方应直接退出而不是启动 Tauri UI。
pub fn run_windows_ssh_proxy_if_requested() -> Option<i32> {
    run_windows_ssh_proxy_if_requested_inner()
}

#[cfg(windows)]
fn run_windows_ssh_proxy_if_requested_inner() -> Option<i32> {
    match std::env::var(GITUI_SSH_PROXY_ENV) {
        Ok(value) if value == GITUI_SSH_PROXY_VALUE => {}
        _ => return None,
    }

    let mut cmd = Command::new("ssh");
    cmd.args(std::env::args_os().skip(1))
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    configure_background_command(&mut cmd);

    let code = match cmd.status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(e) => {
            eprintln!("GitUI SSH proxy failed to spawn ssh.exe: {e}");
            127
        }
    };
    Some(code)
}

#[cfg(not(windows))]
fn run_windows_ssh_proxy_if_requested_inner() -> Option<i32> {
    None
}

/// 创建 GitUI 后台 shellout 使用的 `git` 命令。
pub fn new_git_command(repo_path: Option<&str>) -> Command {
    let mut cmd = Command::new("git");
    configure_shellout_environment(&mut cmd);
    configure_background_command(&mut cmd);
    configure_windows_ssh_proxy(&mut cmd, repo_path);
    cmd
}

fn configure_shellout_environment(cmd: &mut Command) {
    #[cfg(unix)]
    if let Some(path) = shellout_path() {
        cmd.env("PATH", path);
    }
}

#[cfg(unix)]
fn shellout_path() -> Option<&'static OsString> {
    SHELLOUT_PATH
        .get_or_init(|| {
            build_shellout_path(
                env::var_os("PATH"),
                resolve_user_shell_path(),
                common_shellout_dirs(),
            )
        })
        .as_ref()
}

#[cfg(unix)]
fn common_shellout_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/opt/homebrew/sbin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/local/sbin"),
        PathBuf::from("/opt/local/bin"),
        PathBuf::from("/opt/local/sbin"),
    ];

    if let Some(home) = env::var_os("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join("bin"));
    }

    dirs
}

#[cfg(unix)]
fn build_shellout_path(
    current_path: Option<OsString>,
    shell_path: Option<OsString>,
    extra_dirs: Vec<PathBuf>,
) -> Option<OsString> {
    let mut dirs = Vec::new();
    push_path_dirs(&mut dirs, shell_path.as_deref());
    push_path_dirs(&mut dirs, current_path.as_deref());
    for dir in extra_dirs {
        push_unique_path(&mut dirs, dir);
    }

    if dirs.is_empty() {
        return None;
    }

    env::join_paths(dirs).ok()
}

#[cfg(unix)]
fn push_path_dirs(dirs: &mut Vec<PathBuf>, path_env: Option<&OsStr>) {
    let Some(path_env) = path_env else {
        return;
    };
    for dir in env::split_paths(path_env) {
        push_unique_path(dirs, dir);
    }
}

#[cfg(unix)]
fn push_unique_path(dirs: &mut Vec<PathBuf>, dir: PathBuf) {
    if dir.as_os_str().is_empty() || dirs.iter().any(|existing| existing == &dir) {
        return;
    }
    dirs.push(dir);
}

#[cfg(unix)]
fn resolve_user_shell_path() -> Option<OsString> {
    let shell = env::var_os("SHELL")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| OsString::from("/bin/zsh"));

    // Use a non-interactive login shell so macOS GUI launches can pick up
    // user-level PATH setup such as Homebrew's shellenv without running
    // interactive prompts from shell startup files.
    let output = Command::new(shell)
        .arg("-lc")
        .arg(format!(
            "printf '%s%s%s\\n' '{begin}' \"$PATH\" '{end}'",
            begin = SHELL_PATH_BEGIN,
            end = SHELL_PATH_END
        ))
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    parse_marked_shell_path(&output.stdout)
}

#[cfg(unix)]
const SHELL_PATH_BEGIN: &str = "__GITUI_PATH_BEGIN__";
#[cfg(unix)]
const SHELL_PATH_END: &str = "__GITUI_PATH_END__";

#[cfg(unix)]
fn parse_marked_shell_path(stdout: &[u8]) -> Option<OsString> {
    let text = String::from_utf8_lossy(stdout);
    let start = text.find(SHELL_PATH_BEGIN)? + SHELL_PATH_BEGIN.len();
    let end = text[start..].find(SHELL_PATH_END)? + start;
    let path = text[start..end].trim_matches(|ch| ch == '\r' || ch == '\n');
    if path.is_empty() {
        None
    } else {
        Some(OsString::from(path))
    }
}

#[cfg(windows)]
fn configure_windows_ssh_proxy(cmd: &mut Command, repo_path: Option<&str>) {
    if std::env::var_os("GIT_SSH").is_some() || std::env::var_os("GIT_SSH_COMMAND").is_some() {
        return;
    }
    if has_explicit_ssh_command(repo_path) {
        return;
    }

    match std::env::current_exe() {
        Ok(exe) => {
            cmd.env("GIT_SSH", exe)
                .env("GIT_SSH_VARIANT", "ssh")
                .env(GITUI_SSH_PROXY_ENV, GITUI_SSH_PROXY_VALUE);
        }
        Err(e) => {
            log::warn!("[shellout] failed to resolve current executable for SSH proxy: {e}");
        }
    }
}

#[cfg(not(windows))]
fn configure_windows_ssh_proxy(_cmd: &mut Command, _repo_path: Option<&str>) {}

#[cfg(windows)]
fn has_explicit_ssh_command(repo_path: Option<&str>) -> bool {
    let command = repo_path
        .and_then(|path| {
            git2::Repository::open(path)
                .ok()
                .and_then(|repo| repo.config().ok())
                .and_then(|config| config.get_string("core.sshCommand").ok())
        })
        .or_else(|| {
            git2::Config::open_default()
                .ok()
                .and_then(|config| config.get_string("core.sshCommand").ok())
        });

    match command {
        Some(value) => !value.trim().is_empty(),
        None => false,
    }
}

/// 执行 `git -C <path> <args...>` 并返回 stdout；非零退出码时把 stderr 塞进 `OperationFailed`。
///
/// 专门处理 spawn 失败的 `NotFound` 情况，给出明确提示而不是裸 IO 错误。
pub fn run_git(path: &str, args: &[&str]) -> GitResult<String> {
    let mut cmd = new_git_command(Some(path));
    cmd.arg("-C")
        .arg(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            GitError::OperationFailed(
                "git binary not found in PATH. SSH remotes require a system git install."
                    .to_string(),
            )
        } else {
            GitError::OperationFailed(format!("failed to spawn git: {e}"))
        }
    })?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let msg = if stderr.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            stderr
        };
        Err(GitError::OperationFailed(msg))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_scheme() {
        assert!(is_ssh_url("ssh://git@github.com/foo/bar.git"));
        assert!(is_ssh_url("ssh://user@host:22/path"));
    }

    #[test]
    fn scp_like() {
        assert!(is_ssh_url("git@github.com:foo/bar.git"));
        assert!(is_ssh_url("user@example.com:some/path"));
    }

    #[test]
    fn https_and_other_schemes() {
        assert!(!is_ssh_url("https://github.com/foo/bar.git"));
        assert!(!is_ssh_url("http://example.com/repo"));
        assert!(!is_ssh_url("git://github.com/foo/bar.git"));
        assert!(!is_ssh_url("file:///home/x/repo"));
    }

    #[test]
    fn local_paths_are_not_ssh() {
        assert!(!is_ssh_url("C:\\Users\\me\\repo"));
        assert!(!is_ssh_url("/Users/me/repo"));
        assert!(!is_ssh_url("./repo"));
        assert!(!is_ssh_url(""));
    }

    #[test]
    fn https_with_userinfo_not_ssh() {
        // `https://user@host/path` 不应被当作 scp-like（有 scheme 前缀兜底）
        assert!(!is_ssh_url("https://user@github.com/foo/bar.git"));
    }

    #[cfg(unix)]
    #[test]
    fn shellout_path_prefers_shell_path_and_deduplicates() {
        let current = env::join_paths(["/usr/bin", "/opt/homebrew/bin"])
            .expect("valid current path")
            .into();
        let shell = env::join_paths(["/opt/homebrew/bin", "/Users/me/.local/bin"])
            .expect("valid shell path")
            .into();

        let merged = build_shellout_path(
            Some(current),
            Some(shell),
            vec![
                PathBuf::from("/usr/local/bin"),
                PathBuf::from("/opt/homebrew/bin"),
            ],
        )
        .expect("merged path");
        let dirs: Vec<PathBuf> = env::split_paths(&merged).collect();

        assert_eq!(
            dirs,
            vec![
                PathBuf::from("/opt/homebrew/bin"),
                PathBuf::from("/Users/me/.local/bin"),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/usr/local/bin"),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn parses_marked_shell_path_with_startup_noise() {
        let stdout = format!(
            "hello\n{begin}/opt/homebrew/bin:/usr/bin{end}\nignored\n",
            begin = SHELL_PATH_BEGIN,
            end = SHELL_PATH_END
        );

        assert_eq!(
            parse_marked_shell_path(stdout.as_bytes()),
            Some(OsString::from("/opt/homebrew/bin:/usr/bin"))
        );
    }
}
