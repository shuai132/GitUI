//! SSH 远端 fallback：网络操作检测到 SSH URL 时，走系统 `git` 命令而不是 libgit2。
//!
//! 背景：git2 捆绑的 libssh2 在 Windows 上用 WinCNG 后端，支持的 host key 算法不全，
//! 现代 Git 服务端（GitHub 等）常报 `failed to set hostkey preference`。复用系统
//! OpenSSH + ssh-agent + `~/.ssh/config`（即命令行 git 已经能跑的那套配置）绕开问题。
//! HTTPS 仍走 libgit2 + 系统 credential helper，不变。

use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows: 抑制子进程弹出黑色 CMD 控制台窗口。
/// GUI 子系统进程 spawn 控制台应用（git.exe）时，系统默认会为子进程新建控制台窗口，
/// 加此标志可阻止。macOS/Linux 编译时此常量不存在，由 cfg 隔离。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use crate::git::{
    engine::GitEngine,
    error::{GitError, GitResult},
};

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

/// 执行 `git -C <path> <args...>` 并返回 stdout；非零退出码时把 stderr 塞进 `OperationFailed`。
///
/// 专门处理 spawn 失败的 `NotFound` 情况，给出明确提示而不是裸 IO 错误。
pub fn run_git(path: &str, args: &[&str]) -> GitResult<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(path).args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
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
    use super::is_ssh_url;

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
}
