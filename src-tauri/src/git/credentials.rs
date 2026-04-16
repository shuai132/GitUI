use std::cell::Cell;

use git2::{Cred, CredentialType, Error as Git2Error};

/// 跨平台获取用户主目录。
/// Windows 优先读 USERPROFILE，回退 HOMEDRIVE+HOMEPATH；其他平台读 HOME。
fn home_dir() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(p) = std::env::var("USERPROFILE") {
            return p;
        }
        let drive = std::env::var("HOMEDRIVE").unwrap_or_default();
        let path = std::env::var("HOMEPATH").unwrap_or_default();
        return format!("{drive}{path}");
    }
    #[cfg(not(target_os = "windows"))]
    std::env::var("HOME").unwrap_or_default()
}

/// 创建一个带重试计数的凭据回调闭包。
/// git2 在凭据无效时会反复调用 callback，不加计数器会死循环。
pub fn make_credentials_callback(
) -> impl FnMut(&str, Option<&str>, CredentialType) -> Result<Cred, Git2Error> {
    let attempts = Cell::new(0u32);

    move |url, username, allowed_types| {
        let n = attempts.get();
        attempts.set(n + 1);
        log::debug!(
            "[credentials] attempt={} url={url} user={username:?} allowed={allowed_types:?}",
            n + 1
        );

        if n >= 4 {
            log::error!("[credentials] max attempts reached, giving up");
            return Err(Git2Error::from_str(
                "authentication failed: SSH key not accepted after multiple attempts. \
                 Check that ssh-agent is running and your key is added (ssh-add).",
            ));
        }

        // SSH agent authentication
        if allowed_types.contains(CredentialType::SSH_KEY) {
            let user = username.unwrap_or("git");

            // 第 1 次尝试：SSH agent
            if n == 0 {
                log::debug!("[credentials] trying ssh-agent");
                match Cred::ssh_key_from_agent(user) {
                    Ok(cred) => {
                        log::debug!("[credentials] ssh-agent succeeded");
                        return Ok(cred);
                    }
                    Err(e) => {
                        log::debug!("[credentials] ssh-agent failed: {e}");
                    }
                }
            }

            // 第 2 次尝试：~/.ssh/id_ed25519
            if n <= 1 {
                let home = home_dir();
                let ed25519 = std::path::Path::new(&home).join(".ssh/id_ed25519");
                if ed25519.exists() {
                    log::debug!("[credentials] trying {}", ed25519.display());
                    match Cred::ssh_key(user, None, &ed25519, None) {
                        Ok(cred) => {
                            log::debug!("[credentials] ed25519 key succeeded");
                            return Ok(cred);
                        }
                        Err(e) => {
                            log::debug!("[credentials] ed25519 key failed: {e}");
                        }
                    }
                }
            }

            // 第 3 次尝试：~/.ssh/id_rsa
            if n <= 2 {
                let home = home_dir();
                let rsa = std::path::Path::new(&home).join(".ssh/id_rsa");
                if rsa.exists() {
                    log::debug!("[credentials] trying {}", rsa.display());
                    match Cred::ssh_key(user, None, &rsa, None) {
                        Ok(cred) => {
                            log::debug!("[credentials] rsa key succeeded");
                            return Ok(cred);
                        }
                        Err(e) => {
                            log::debug!("[credentials] rsa key failed: {e}");
                        }
                    }
                }
            }
        }

        // Default credentials (git credential helper for HTTPS)
        if allowed_types.contains(CredentialType::DEFAULT) {
            log::debug!("[credentials] trying default credential helper");
            return Cred::default();
        }

        if allowed_types.contains(CredentialType::USER_PASS_PLAINTEXT) {
            log::debug!("[credentials] trying default credential helper (userpass)");
            return Cred::credential_helper(
                &git2::Config::open_default().map_err(|e| {
                    Git2Error::from_str(&format!("failed to open git config: {e}"))
                })?,
                url,
                username,
            );
        }

        Err(Git2Error::from_str(&format!(
            "no credentials available for {url}"
        )))
    }
}
