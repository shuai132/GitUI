use std::{
    collections::{HashMap, HashSet},
    fs::{File, OpenOptions},
    io::{self, BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    panic::{catch_unwind, AssertUnwindSafe},
    path::PathBuf,
    sync::Arc,
    thread,
    time::Duration,
};

use fs2::FileExt;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};
use uuid::Uuid;

use crate::git::types::RepoMeta;

const LOCK_FILE: &str = "tray-owner.lock";
const STATE_FILE: &str = "tray-owner.json";
const LOCALHOST: &str = "127.0.0.1";
const ELECTION_RETRY: Duration = Duration::from_millis(300);

#[derive(Clone)]
pub struct TrayCoordinator {
    inner: Arc<Mutex<CoordinatorInner>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalWindowCloseAction {
    ExitProcess,
    HideOwnerHost,
}

struct CoordinatorInner {
    window_id: String,
    pid: u32,
    app: Option<AppHandle>,
    paths: Option<CoordinatorPaths>,
    mode: CoordinatorMode,
    election_running: bool,
    local_window_closed: bool,
    local_active_repo: Option<RepoMeta>,
}

#[derive(Debug, Clone)]
struct CoordinatorPaths {
    lock_path: PathBuf,
    state_path: PathBuf,
}

enum CoordinatorMode {
    Unstarted,
    Owner(OwnerRuntime),
    Client(ClientRuntime),
}

struct OwnerRuntime {
    token: String,
    #[allow(dead_code)]
    lock_file: File,
    state_path: PathBuf,
    registry: OwnerRegistry,
    tray: Option<TrayIcon>,
}

struct ClientRuntime {
    token: String,
    writer: SharedWriter,
}

type SharedWriter = Arc<Mutex<TcpStream>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OwnerState {
    port: u16,
    token: String,
    pid: u32,
    window_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
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
enum OwnerMessage {
    ShowWindow {
        token: String,
        #[serde(default)]
        open_path: Option<String>,
    },
    Quit {
        token: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MenuEntry {
    window_id: String,
    label: String,
}

struct WindowRecord {
    window_id: String,
    pid: u32,
    active_repo: Option<RepoMeta>,
    writer: Option<SharedWriter>,
    is_local: bool,
    seq: u64,
}

struct OwnerRegistry {
    windows: HashMap<String, WindowRecord>,
    next_seq: u64,
    last_active_window_id: Option<String>,
}

impl TrayCoordinator {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(CoordinatorInner {
                window_id: Uuid::new_v4().to_string(),
                pid: std::process::id(),
                app: None,
                paths: None,
                mode: CoordinatorMode::Unstarted,
                election_running: false,
                local_window_closed: false,
                local_active_repo: None,
            })),
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

enum CoordinatorAction {
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

impl OwnerRegistry {
    fn new() -> Self {
        Self {
            windows: HashMap::new(),
            next_seq: 1,
            last_active_window_id: None,
        }
    }

    fn register_window(
        &mut self,
        window_id: String,
        pid: u32,
        active_repo: Option<RepoMeta>,
        writer: Option<SharedWriter>,
        is_local: bool,
    ) {
        let seq = self.next_seq;
        let record = self.windows.entry(window_id.clone()).or_insert_with(|| {
            self.next_seq += 1;
            WindowRecord {
                window_id: window_id.clone(),
                pid,
                active_repo: None,
                writer: None,
                is_local,
                seq,
            }
        });
        record.pid = pid;
        record.active_repo = active_repo;
        if writer.is_some() {
            record.writer = writer;
        }
        record.is_local = is_local;
        if record.active_repo.is_some() {
            self.last_active_window_id = Some(window_id);
        } else if self.last_active_window_id.as_deref() == Some(record.window_id.as_str()) {
            self.last_active_window_id = None;
        }
    }

    fn update_active_repo(&mut self, window_id: &str, active_repo: Option<RepoMeta>) {
        if let Some(record) = self.windows.get_mut(window_id) {
            record.active_repo = active_repo;
            if record.active_repo.is_some() {
                self.last_active_window_id = Some(window_id.to_string());
            } else if self.last_active_window_id.as_deref() == Some(window_id) {
                self.last_active_window_id = None;
            }
        }
    }

    fn remove_window(&mut self, window_id: &str) {
        self.windows.remove(window_id);
        if self.last_active_window_id.as_deref() == Some(window_id) {
            self.last_active_window_id = None;
        }
    }

    fn has_windows(&self) -> bool {
        !self.windows.is_empty()
    }

    fn writer_for(&self, window_id: &str) -> Option<SharedWriter> {
        self.windows
            .get(window_id)
            .and_then(|record| record.writer.as_ref().map(Arc::clone))
    }

    fn remote_writers(&self) -> Vec<SharedWriter> {
        self.windows
            .values()
            .filter_map(|record| {
                (!record.is_local)
                    .then(|| record.writer.as_ref().map(Arc::clone))
                    .flatten()
            })
            .collect()
    }

    fn preferred_window_id(&self) -> Option<String> {
        if let Some(id) = &self.last_active_window_id {
            if self
                .windows
                .get(id)
                .is_some_and(|record| record.active_repo.is_some())
            {
                return Some(id.clone());
            }
        }
        self.sorted_records()
            .into_iter()
            .find(|record| record.active_repo.is_some())
            .or_else(|| self.sorted_records().into_iter().next())
            .map(|record| record.window_id.clone())
    }

    fn menu_entries(&self) -> Vec<MenuEntry> {
        let records = self
            .sorted_records()
            .into_iter()
            .filter(|record| record.active_repo.is_some())
            .collect::<Vec<_>>();

        let duplicate_names = duplicate_repo_names(&records);
        records
            .into_iter()
            .filter_map(|record| {
                let repo = record.active_repo.as_ref()?;
                let label = if duplicate_names.contains(&repo.name) {
                    format!("{} - {}", repo.name, repo.path)
                } else {
                    repo.name.clone()
                };
                Some(MenuEntry {
                    window_id: record.window_id.clone(),
                    label,
                })
            })
            .collect()
    }

    fn sorted_records(&self) -> Vec<&WindowRecord> {
        let mut records = self.windows.values().collect::<Vec<_>>();
        records.sort_by_key(|record| record.seq);
        records
    }
}

fn duplicate_repo_names(records: &[&WindowRecord]) -> HashSet<String> {
    let mut seen = HashSet::new();
    let mut duplicates = HashSet::new();
    for record in records {
        if let Some(repo) = &record.active_repo {
            if !seen.insert(repo.name.clone()) {
                duplicates.insert(repo.name.clone());
            }
        }
    }
    duplicates
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    app.state::<TrayCoordinator>().start(app.clone())
}

fn start_election_loop(inner: Arc<Mutex<CoordinatorInner>>, app: AppHandle) {
    {
        let mut guard = inner.lock();
        if guard.election_running {
            return;
        }
        guard.election_running = true;
    }

    thread::Builder::new()
        .name("gitui tray coordinator election".to_string())
        .spawn(move || loop {
            match try_become_owner(&inner, &app) {
                Ok(true) => {
                    inner.lock().election_running = false;
                    break;
                }
                Ok(false) => {}
                Err(err) => log::warn!("[tray] owner election failed: {err}"),
            }

            match try_become_client(&inner, &app) {
                Ok(()) => {
                    inner.lock().election_running = false;
                    break;
                }
                Err(err) => {
                    log::debug!("[tray] owner connect failed: {err}");
                    thread::sleep(ELECTION_RETRY);
                }
            }
        })
        .expect("failed to spawn tray coordinator election thread");
}

fn try_become_owner(inner: &Arc<Mutex<CoordinatorInner>>, app: &AppHandle) -> io::Result<bool> {
    let paths = {
        let guard = inner.lock();
        if !matches!(guard.mode, CoordinatorMode::Unstarted) {
            return Ok(true);
        }
        guard.paths.clone().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "tray coordinator paths missing")
        })?
    };

    let lock_file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&paths.lock_path)?;

    match lock_file.try_lock_exclusive() {
        Ok(()) => {}
        Err(err) if err.kind() == io::ErrorKind::WouldBlock => return Ok(false),
        Err(err) => return Err(err),
    }

    let listener = TcpListener::bind((LOCALHOST, 0))?;
    let port = listener.local_addr()?.port();
    let token = Uuid::new_v4().to_string();
    let (window_id, pid, active_repo, local_window_closed) = {
        let guard = inner.lock();
        (
            guard.window_id.clone(),
            guard.pid,
            guard.local_active_repo.clone(),
            guard.local_window_closed,
        )
    };

    write_owner_state(
        &paths.state_path,
        &OwnerState {
            port,
            token: token.clone(),
            pid,
            window_id: window_id.clone(),
        },
    )?;

    {
        let mut guard = inner.lock();
        let mut registry = OwnerRegistry::new();
        if !local_window_closed {
            registry.register_window(window_id, pid, active_repo, None, true);
        }
        guard.mode = CoordinatorMode::Owner(OwnerRuntime {
            token: token.clone(),
            lock_file,
            state_path: paths.state_path.clone(),
            registry,
            tray: None,
        });
    }

    spawn_owner_accept_loop(Arc::clone(inner), app.clone(), listener, token);
    schedule_rebuild_tray_menu(Arc::clone(inner), app.clone());
    log::info!("[tray] became tray owner on {LOCALHOST}:{port}");
    Ok(true)
}

fn try_become_client(inner: &Arc<Mutex<CoordinatorInner>>, app: &AppHandle) -> io::Result<()> {
    let (state_path, window_id, pid, active_repo) = {
        let guard = inner.lock();
        if !matches!(guard.mode, CoordinatorMode::Unstarted) {
            return Ok(());
        }
        let paths = guard.paths.clone().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "tray coordinator paths missing")
        })?;
        (
            paths.state_path,
            guard.window_id.clone(),
            guard.pid,
            guard.local_active_repo.clone(),
        )
    };

    let state = read_owner_state(&state_path)?;
    let stream = TcpStream::connect((LOCALHOST, state.port))?;
    stream.set_nodelay(true)?;
    let writer = Arc::new(Mutex::new(stream.try_clone()?));
    send_json_line(
        &writer,
        &ClientMessage::RegisterWindow {
            token: state.token.clone(),
            window_id: window_id.clone(),
            pid,
            active_repo,
        },
    )?;

    {
        let mut guard = inner.lock();
        guard.mode = CoordinatorMode::Client(ClientRuntime {
            token: state.token.clone(),
            writer: Arc::clone(&writer),
        });
    }

    spawn_client_read_loop(Arc::clone(inner), app.clone(), stream, state.token);
    log::info!("[tray] connected to tray owner for window {window_id}");
    Ok(())
}

fn spawn_owner_accept_loop(
    inner: Arc<Mutex<CoordinatorInner>>,
    app: AppHandle,
    listener: TcpListener,
    token: String,
) {
    thread::Builder::new()
        .name("gitui tray owner accept".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let inner = Arc::clone(&inner);
                        let app = app.clone();
                        let token = token.clone();
                        thread::Builder::new()
                            .name("gitui tray owner client".to_string())
                            .spawn(move || handle_owner_client_stream(inner, app, stream, token))
                            .expect("failed to spawn tray owner client thread");
                    }
                    Err(err) => {
                        log::warn!("[tray] owner accept failed: {err}");
                        break;
                    }
                }
            }
        })
        .expect("failed to spawn tray owner accept thread");
}

fn spawn_client_read_loop(
    inner: Arc<Mutex<CoordinatorInner>>,
    app: AppHandle,
    stream: TcpStream,
    expected_token: String,
) {
    thread::Builder::new()
        .name("gitui tray client read".to_string())
        .spawn(move || {
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => match serde_json::from_str::<OwnerMessage>(&line) {
                        Ok(message) => handle_owner_message(&app, &expected_token, message),
                        Err(err) => log::warn!("[tray] invalid owner message: {err}"),
                    },
                    Err(err) => {
                        log::warn!("[tray] owner connection failed: {err}");
                        break;
                    }
                }
            }
            handle_client_disconnected(inner, app);
        })
        .expect("failed to spawn tray client read thread");
}

fn handle_owner_client_stream(
    inner: Arc<Mutex<CoordinatorInner>>,
    app: AppHandle,
    stream: TcpStream,
    expected_token: String,
) {
    let writer = match stream.try_clone() {
        Ok(stream) => Arc::new(Mutex::new(stream)),
        Err(err) => {
            log::warn!("[tray] failed to clone client stream: {err}");
            return;
        }
    };
    let mut registered_window_id: Option<String> = None;
    let mut reader = BufReader::new(stream);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let message = match serde_json::from_str::<ClientMessage>(&line) {
                    Ok(message) => message,
                    Err(err) => {
                        log::warn!("[tray] invalid client message: {err}");
                        continue;
                    }
                };
                if !client_message_has_token(&message, &expected_token) {
                    log::warn!("[tray] ignored client message with invalid token");
                    break;
                }
                if let Some(window_id) =
                    handle_client_message(Arc::clone(&inner), &app, message, Arc::clone(&writer))
                {
                    registered_window_id = Some(window_id);
                }
            }
            Err(err) => {
                log::warn!("[tray] client connection failed: {err}");
                break;
            }
        }
    }

    if let Some(window_id) = registered_window_id {
        remove_owner_window(inner, app, &window_id);
    }
}

fn handle_client_message(
    inner: Arc<Mutex<CoordinatorInner>>,
    app: &AppHandle,
    message: ClientMessage,
    writer: SharedWriter,
) -> Option<String> {
    let mut registered_window_id = None;

    {
        let mut guard = inner.lock();
        let CoordinatorMode::Owner(owner) = &mut guard.mode else {
            return None;
        };
        match message {
            ClientMessage::RegisterWindow {
                window_id,
                pid,
                active_repo,
                ..
            } => {
                owner.registry.register_window(
                    window_id.clone(),
                    pid,
                    active_repo,
                    Some(writer),
                    false,
                );
                registered_window_id = Some(window_id);
            }
            ClientMessage::UpdateActiveRepo {
                window_id,
                active_repo,
                ..
            } => {
                owner.registry.update_active_repo(&window_id, active_repo);
                registered_window_id = Some(window_id);
            }
            ClientMessage::WindowClosed { window_id, .. } => {
                owner.registry.remove_window(&window_id);
                registered_window_id = Some(window_id);
            }
            ClientMessage::Quit { .. } => {
                drop(guard);
                app.exit(0);
                return registered_window_id;
            }
        }
    }

    schedule_rebuild_tray_menu(inner, app.clone());
    registered_window_id
}

fn handle_owner_message(app: &AppHandle, expected_token: &str, message: OwnerMessage) {
    match message {
        OwnerMessage::ShowWindow { token, open_path } if token == expected_token => {
            show_local_window(app.clone(), open_path);
        }
        OwnerMessage::Quit { token } if token == expected_token => {
            app.exit(0);
        }
        _ => log::warn!("[tray] ignored owner message with invalid token"),
    }
}

fn handle_client_disconnected(inner: Arc<Mutex<CoordinatorInner>>, app: AppHandle) {
    {
        let mut guard = inner.lock();
        if matches!(guard.mode, CoordinatorMode::Client(_)) {
            guard.mode = CoordinatorMode::Unstarted;
        } else {
            return;
        }
    }
    start_election_loop(inner, app);
}

fn remove_owner_window(inner: Arc<Mutex<CoordinatorInner>>, app: AppHandle, window_id: &str) {
    let should_exit = {
        let mut guard = inner.lock();
        let local_window_closed = guard.local_window_closed;
        let CoordinatorMode::Owner(owner) = &mut guard.mode else {
            return;
        };
        owner.registry.remove_window(window_id);
        local_window_closed && !owner.registry.has_windows()
    };

    if should_exit {
        app.exit(0);
    } else {
        schedule_rebuild_tray_menu(inner, app);
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

fn schedule_rebuild_tray_menu(inner: Arc<Mutex<CoordinatorInner>>, app: AppHandle) {
    let app_for_thread = app.clone();
    if let Err(err) = app.run_on_main_thread(move || {
        if catch_unwind(AssertUnwindSafe(|| {
            if let Err(err) = rebuild_tray_menu(&inner, &app_for_thread) {
                log::warn!("[tray] failed to rebuild menu: {err}");
            }
        }))
        .is_err()
        {
            log::error!("[tray] panic while rebuilding tray menu");
        }
    }) {
        log::warn!("[tray] failed to schedule tray menu rebuild: {err}");
    }
}

fn rebuild_tray_menu(inner: &Arc<Mutex<CoordinatorInner>>, app: &AppHandle) -> tauri::Result<()> {
    let entries = {
        let guard = inner.lock();
        let CoordinatorMode::Owner(owner) = &guard.mode else {
            return Ok(());
        };
        owner.registry.menu_entries()
    };
    let menu = build_tray_menu(app, &entries)?;

    let mut guard = inner.lock();
    let CoordinatorMode::Owner(owner) = &mut guard.mode else {
        return Ok(());
    };
    if let Some(tray) = &owner.tray {
        tray.set_menu(Some(menu))?;
    } else {
        let tray = build_tray_icon(app, &menu)?;
        owner.tray = Some(tray);
    }
    Ok(())
}

fn build_tray_menu(app: &AppHandle, entries: &[MenuEntry]) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    menu.append(&show)?;

    if !entries.is_empty() {
        let separator = PredefinedMenuItem::separator(app)?;
        menu.append(&separator)?;
        for entry in entries {
            let item = MenuItem::with_id(
                app,
                format!("window:{}", entry.window_id),
                &entry.label,
                true,
                None::<&str>,
            )?;
            menu.append(&item)?;
        }
    }

    let separator = PredefinedMenuItem::separator(app)?;
    menu.append(&separator)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    menu.append(&quit)?;
    Ok(menu)
}

fn build_tray_icon(app: &AppHandle, menu: &Menu<Wry>) -> tauri::Result<TrayIcon> {
    let mut tray_builder = TrayIconBuilder::new()
        .menu(menu)
        .show_menu_on_left_click(false)
        .tooltip("GitUI")
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            let app = app.clone();
            if catch_unwind(AssertUnwindSafe(|| {
                app.state::<TrayCoordinator>()
                    .handle_tray_menu_event(&app, &id);
            }))
            .is_err()
            {
                log::error!("[tray] panic in tray menu callback");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle().clone();
                if catch_unwind(AssertUnwindSafe(|| {
                    app.state::<TrayCoordinator>().show_preferred_window();
                }))
                .is_err()
                {
                    log::error!("[tray] panic in tray icon callback");
                }
            }
        });

    #[cfg(target_os = "macos")]
    {
        tray_builder = tray_builder
            .icon(tauri::include_image!("./icons/tray-template.png"))
            .icon_as_template(true);
    }

    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    tray_builder.build(app)
}

fn show_local_window(app: AppHandle, open_path: Option<String>) {
    let app_for_thread = app.clone();
    if let Err(err) = app.run_on_main_thread(move || {
        if catch_unwind(AssertUnwindSafe(|| {
            if let Some(window) = app_for_thread.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            if let Some(path) = open_path {
                let _ = app_for_thread.emit("repo://open-path", path);
            }
        }))
        .is_err()
        {
            log::error!("[tray] panic while showing local window");
        }
    }) {
        log::warn!("[tray] failed to schedule local window show: {err}");
    }
}

fn client_message_has_token(message: &ClientMessage, expected: &str) -> bool {
    match message {
        ClientMessage::RegisterWindow { token, .. }
        | ClientMessage::UpdateActiveRepo { token, .. }
        | ClientMessage::WindowClosed { token, .. }
        | ClientMessage::Quit { token } => token == expected,
    }
}

fn send_json_line<T: Serialize>(writer: &SharedWriter, message: &T) -> io::Result<()> {
    let line = serde_json::to_string(message)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    let mut stream = writer.lock();
    stream.write_all(line.as_bytes())?;
    stream.write_all(b"\n")?;
    stream.flush()
}

fn read_owner_state(path: &PathBuf) -> io::Result<OwnerState> {
    let data = std::fs::read(path)?;
    serde_json::from_slice(&data).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
}

fn write_owner_state(path: &PathBuf, state: &OwnerState) -> io::Result<()> {
    let data =
        serde_json::to_vec(state).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, data)?;
    std::fs::rename(tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(id: &str, name: &str, path: &str) -> RepoMeta {
        RepoMeta {
            id: id.to_string(),
            name: name.to_string(),
            path: path.to_string(),
        }
    }

    #[test]
    fn registry_adds_updates_and_removes_windows() {
        let mut registry = OwnerRegistry::new();
        registry.register_window(
            "window-a".to_string(),
            1,
            Some(repo("repo-a", "alpha", "/repos/alpha")),
            None,
            true,
        );
        registry.register_window("window-b".to_string(), 2, None, None, false);

        assert_eq!(registry.menu_entries().len(), 1);

        registry.update_active_repo("window-b", Some(repo("repo-b", "beta", "/repos/beta")));
        assert_eq!(
            registry
                .menu_entries()
                .into_iter()
                .map(|entry| entry.label)
                .collect::<Vec<_>>(),
            vec!["alpha".to_string(), "beta".to_string()]
        );

        registry.remove_window("window-a");
        assert_eq!(
            registry.menu_entries(),
            vec![MenuEntry {
                window_id: "window-b".to_string(),
                label: "beta".to_string()
            }]
        );
    }

    #[test]
    fn registry_disambiguates_duplicate_repo_names() {
        let mut registry = OwnerRegistry::new();
        registry.register_window(
            "window-a".to_string(),
            1,
            Some(repo("repo-a", "app", "/work/a/app")),
            None,
            true,
        );
        registry.register_window(
            "window-b".to_string(),
            2,
            Some(repo("repo-b", "app", "/work/b/app")),
            None,
            false,
        );
        registry.register_window(
            "window-c".to_string(),
            3,
            Some(repo("repo-c", "docs", "/work/docs")),
            None,
            false,
        );

        let labels = registry
            .menu_entries()
            .into_iter()
            .map(|entry| entry.label)
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "app - /work/a/app".to_string(),
                "app - /work/b/app".to_string(),
                "docs".to_string()
            ]
        );
    }

    #[test]
    fn preferred_window_tracks_latest_active_window_and_disconnects() {
        let mut registry = OwnerRegistry::new();
        registry.register_window(
            "window-a".to_string(),
            1,
            Some(repo("repo-a", "alpha", "/repos/alpha")),
            None,
            true,
        );
        registry.register_window(
            "window-b".to_string(),
            2,
            Some(repo("repo-b", "beta", "/repos/beta")),
            None,
            false,
        );

        assert_eq!(registry.preferred_window_id().as_deref(), Some("window-b"));

        registry.remove_window("window-b");

        assert_eq!(registry.preferred_window_id().as_deref(), Some("window-a"));
    }

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
