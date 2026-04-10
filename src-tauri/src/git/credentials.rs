use git2::{Cred, CredentialType, Error as Git2Error};

pub fn credential_callback(
    url: &str,
    username: Option<&str>,
    allowed_types: CredentialType,
) -> Result<Cred, Git2Error> {
    // SSH agent authentication
    if allowed_types.contains(CredentialType::SSH_KEY) {
        let user = username.unwrap_or("git");
        if let Ok(cred) = Cred::ssh_key_from_agent(user) {
            return Ok(cred);
        }
        // Try default SSH key locations
        let home = std::env::var("HOME").unwrap_or_default();
        let ed25519 = std::path::Path::new(&home).join(".ssh/id_ed25519");
        let rsa = std::path::Path::new(&home).join(".ssh/id_rsa");
        if ed25519.exists() {
            if let Ok(cred) = Cred::ssh_key(user, None, &ed25519, None) {
                return Ok(cred);
            }
        }
        if rsa.exists() {
            if let Ok(cred) = Cred::ssh_key(user, None, &rsa, None) {
                return Ok(cred);
            }
        }
    }

    // Default credentials (git credential helper)
    if allowed_types.contains(CredentialType::DEFAULT) {
        return Cred::default();
    }

    Err(Git2Error::from_str(&format!(
        "No credentials available for {}",
        url
    )))
}
