use std::{fs::File, net::TcpStream, path::PathBuf, sync::Arc};

use parking_lot::Mutex;
use tauri::{tray::TrayIcon, AppHandle};

use crate::git::types::RepoMeta;

use super::{
    protocol::{ClientMessage, OwnerMessage},
    registry::OwnerRegistry,
};

pub(super) type SharedWriter = Arc<Mutex<TcpStream>>;

pub(super) struct CoordinatorInner {
    pub(super) window_id: String,
    pub(super) pid: u32,
    pub(super) app: Option<AppHandle>,
    pub(super) paths: Option<CoordinatorPaths>,
    pub(super) mode: CoordinatorMode,
    pub(super) election_running: bool,
    pub(super) local_window_closed: bool,
    pub(super) local_active_repo: Option<RepoMeta>,
}

impl CoordinatorInner {
    pub(super) fn new(window_id: String, pid: u32) -> Self {
        Self {
            window_id,
            pid,
            app: None,
            paths: None,
            mode: CoordinatorMode::Unstarted,
            election_running: false,
            local_window_closed: false,
            local_active_repo: None,
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct CoordinatorPaths {
    pub(super) lock_path: PathBuf,
    pub(super) state_path: PathBuf,
}

pub(super) enum CoordinatorMode {
    Unstarted,
    Owner(Box<OwnerRuntime>),
    Client(ClientRuntime),
}

pub(super) struct OwnerRuntime {
    pub(super) token: String,
    #[allow(dead_code)]
    pub(super) lock_file: File,
    pub(super) state_path: PathBuf,
    pub(super) registry: OwnerRegistry,
    pub(super) tray: Option<TrayIcon>,
}

pub(super) struct ClientRuntime {
    pub(super) token: String,
    pub(super) writer: SharedWriter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalWindowCloseAction {
    ExitProcess,
    HideOwnerHost,
}

pub(super) enum CoordinatorAction {
    None,
    RebuildTray(Option<AppHandle>),
    ShowLocal {
        app: Option<AppHandle>,
        open_path: Option<String>,
    },
    SendClient {
        writer: SharedWriter,
        message: ClientMessage,
        app: Option<AppHandle>,
    },
    SendOwner {
        writer: SharedWriter,
        message: OwnerMessage,
    },
}
