mod menu;
mod protocol;
mod registry;
mod state;
mod transport;

use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::git::types::RepoMeta;

use menu::{schedule_rebuild_tray_menu, show_local_window};
use protocol::{ClientMessage, OwnerMessage, LOCK_FILE, STATE_FILE};
pub use state::LocalWindowCloseAction;
use state::{CoordinatorAction, CoordinatorInner, CoordinatorMode, CoordinatorPaths};
use transport::{handle_client_disconnected, send_json_line, start_election_loop};

#[derive(Clone)]
pub struct TrayCoordinator {
    inner: Arc<Mutex<CoordinatorInner>>,
}

impl TrayCoordinator {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(CoordinatorInner::new(
                Uuid::new_v4().to_string(),
                std::process::id(),
            ))),
        }
    }

    pub fn start(&self, app: AppHandle) -> tauri::Result<()> {
        let data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&data_dir)?;
        let paths = CoordinatorPaths {
            lock_path: data_dir.join(LOCK_FILE),
            state_path: data_dir.join(STATE_FILE),
        };

        {
            let mut inner = self.inner.lock();
            inner.app = Some(app.clone());
            inner.paths = Some(paths);
        }

        start_election_loop(Arc::clone(&self.inner), app);
        Ok(())
    }

    pub fn update_active_repo(&self, active_repo: Option<RepoMeta>) {
        let action = {
            let mut inner = self.inner.lock();
            inner.local_active_repo = active_repo.clone();
            let window_id = inner.window_id.clone();
            let pid = inner.pid;
            let local_window_closed = inner.local_window_closed;
            match &mut inner.mode {
                CoordinatorMode::Owner(owner) => {
                    if !local_window_closed {
                        owner
                            .registry
                            .register_window(window_id, pid, active_repo, None, true);
                    }
                    CoordinatorAction::RebuildTray(inner.app.clone())
                }
                CoordinatorMode::Client(client) => CoordinatorAction::SendClient {
                    writer: Arc::clone(&client.writer),
                    message: ClientMessage::UpdateActiveRepo {
                        token: client.token.clone(),
                        window_id,
                        active_repo,
                    },
                    app: inner.app.clone(),
                },
                CoordinatorMode::Unstarted => CoordinatorAction::None,
            }
        };
        run_coordinator_action(Arc::clone(&self.inner), action);
    }

    pub fn is_local_window_closed(&self) -> bool {
        self.inner.lock().local_window_closed
    }

    pub fn close_local_window(&self) -> LocalWindowCloseAction {
        let (action, close_action) = {
            let mut inner = self.inner.lock();
            inner.local_window_closed = true;
            inner.local_active_repo = None;
            let window_id = inner.window_id.clone();
            match &mut inner.mode {
                CoordinatorMode::Owner(owner) => {
                    owner.registry.remove_window(&window_id);
                    let has_other_windows = owner.registry.has_windows();
                    if has_other_windows {
                        (
                            CoordinatorAction::RebuildTray(inner.app.clone()),
                            LocalWindowCloseAction::HideOwnerHost,
                        )
                    } else {
                        let state_path = owner.state_path.clone();
                        let _ = std::fs::remove_file(state_path);
                        (CoordinatorAction::None, LocalWindowCloseAction::ExitProcess)
                    }
                }
                CoordinatorMode::Client(client) => (
                    CoordinatorAction::SendClient {
                        writer: Arc::clone(&client.writer),
                        message: ClientMessage::WindowClosed {
                            token: client.token.clone(),
                            window_id,
                        },
                        app: inner.app.clone(),
                    },
                    LocalWindowCloseAction::ExitProcess,
                ),
                CoordinatorMode::Unstarted => {
                    (CoordinatorAction::None, LocalWindowCloseAction::ExitProcess)
                }
            }
        };
        run_coordinator_action(Arc::clone(&self.inner), action);
        close_action
    }

    pub fn show_preferred_window(&self) {
        self.show_window(None, None);
    }

    pub fn show_with_open_path(&self, open_path: String) {
        self.show_window(None, Some(open_path));
    }

    fn show_window(&self, target_window_id: Option<String>, open_path: Option<String>) {
        let action = {
            let inner = self.inner.lock();
            match &inner.mode {
                CoordinatorMode::Owner(owner) => {
                    let window_id = target_window_id
                        .or_else(|| owner.registry.preferred_window_id())
                        .or_else(|| (!inner.local_window_closed).then(|| inner.window_id.clone()));
                    match window_id {
                        Some(id) if id == inner.window_id && !inner.local_window_closed => {
                            CoordinatorAction::ShowLocal {
                                app: inner.app.clone(),
                                open_path,
                            }
                        }
                        Some(id) => {
                            if let Some(writer) = owner.registry.writer_for(&id) {
                                CoordinatorAction::SendOwner {
                                    writer,
                                    message: OwnerMessage::ShowWindow {
                                        token: owner.token.clone(),
                                        open_path,
                                    },
                                }
                            } else {
                                CoordinatorAction::None
                            }
                        }
                        None => CoordinatorAction::None,
                    }
                }
                CoordinatorMode::Client(_) | CoordinatorMode::Unstarted => {
                    CoordinatorAction::ShowLocal {
                        app: inner.app.clone(),
                        open_path,
                    }
                }
            }
        };
        run_coordinator_action(Arc::clone(&self.inner), action);
    }

    fn handle_tray_menu_event(&self, app: &AppHandle, id: &str) {
        match id {
            "quit" => self.quit_all(app),
            "show" => self.show_preferred_window(),
            item if item.starts_with("window:") => {
                self.show_window(Some(item["window:".len()..].to_string()), None);
            }
            _ => {}
        }
    }

    fn quit_all(&self, app: &AppHandle) {
        let messages = {
            let mut inner = self.inner.lock();
            match &mut inner.mode {
                CoordinatorMode::Owner(owner) => {
                    let token = owner.token.clone();
                    let writers = owner.registry.remote_writers();
                    let _ = std::fs::remove_file(&owner.state_path);
                    writers
                        .into_iter()
                        .map(|writer| {
                            (
                                writer,
                                OwnerMessage::Quit {
                                    token: token.clone(),
                                },
                            )
                        })
                        .collect::<Vec<_>>()
                }
                CoordinatorMode::Client(client) => {
                    let message = ClientMessage::Quit {
                        token: client.token.clone(),
                    };
                    let writer = Arc::clone(&client.writer);
                    drop(inner);
                    let _ = send_json_line(&writer, &message);
                    app.exit(0);
                    return;
                }
                CoordinatorMode::Unstarted => Vec::new(),
            }
        };

        for (writer, message) in messages {
            let _ = send_json_line(&writer, &message);
        }
        app.exit(0);
    }
}

fn run_coordinator_action(inner: Arc<Mutex<CoordinatorInner>>, action: CoordinatorAction) {
    match action {
        CoordinatorAction::None => {}
        CoordinatorAction::RebuildTray(Some(app)) => schedule_rebuild_tray_menu(inner, app),
        CoordinatorAction::RebuildTray(None) => {}
        CoordinatorAction::ShowLocal {
            app: Some(app),
            open_path,
        } => show_local_window(app, open_path),
        CoordinatorAction::ShowLocal { app: None, .. } => {}
        CoordinatorAction::SendClient {
            writer,
            message,
            app,
        } => {
            if send_json_line(&writer, &message).is_err() {
                if let Some(app) = app {
                    handle_client_disconnected(inner, app);
                }
            }
        }
        CoordinatorAction::SendOwner { writer, message } => {
            let _ = send_json_line(&writer, &message);
        }
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    app.state::<TrayCoordinator>().start(app.clone())
}
