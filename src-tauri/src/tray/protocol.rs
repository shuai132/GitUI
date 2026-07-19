use std::{io, path::PathBuf};

use serde::{Deserialize, Serialize};

use crate::git::types::RepoMeta;

pub(super) const LOCK_FILE: &str = "tray-owner.lock";
pub(super) const STATE_FILE: &str = "tray-owner.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct OwnerState {
    pub(super) port: u16,
    pub(super) token: String,
    pub(super) pid: u32,
    pub(super) window_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum ClientMessage {
    RegisterWindow {
        token: String,
        window_id: String,
        pid: u32,
        active_repo: Option<RepoMeta>,
    },
    UpdateActiveRepo {
        token: String,
        window_id: String,
        active_repo: Option<RepoMeta>,
    },
    WindowClosed {
        token: String,
        window_id: String,
    },
    Quit {
        token: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum OwnerMessage {
    ShowWindow {
        token: String,
        #[serde(default)]
        open_path: Option<String>,
    },
    Quit {
        token: String,
    },
}

pub(super) fn client_message_has_token(message: &ClientMessage, expected: &str) -> bool {
    match message {
        ClientMessage::RegisterWindow { token, .. }
        | ClientMessage::UpdateActiveRepo { token, .. }
        | ClientMessage::WindowClosed { token, .. }
        | ClientMessage::Quit { token } => token == expected,
    }
}

pub(super) fn read_owner_state(path: &PathBuf) -> io::Result<OwnerState> {
    let data = std::fs::read(path)?;
    serde_json::from_slice(&data).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
}

pub(super) fn write_owner_state(path: &PathBuf, state: &OwnerState) -> io::Result<()> {
    let data =
        serde_json::to_vec(state).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, data)?;
    std::fs::rename(tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_state_roundtrips_for_reconnect_election_path() {
        let dir = tempfile::tempdir().unwrap();
        let state_path = dir.path().join(STATE_FILE);
        let state = OwnerState {
            port: 49152,
            token: "token".to_string(),
            pid: 42,
            window_id: "window-a".to_string(),
        };

        write_owner_state(&state_path, &state).unwrap();

        let loaded = read_owner_state(&state_path).unwrap();
        assert_eq!(loaded.port, state.port);
        assert_eq!(loaded.token, state.token);
        assert_eq!(loaded.window_id, state.window_id);
    }
}
