use std::{
    fs::OpenOptions,
    io::{self, BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::Arc,
    thread,
    time::Duration,
};

use fs2::FileExt;
use parking_lot::Mutex;
use serde::Serialize;
use tauri::AppHandle;
use uuid::Uuid;

use super::{
    menu::{schedule_rebuild_tray_menu, show_local_window},
    protocol::{
        client_message_has_token, read_owner_state, write_owner_state, ClientMessage, OwnerMessage,
        OwnerState,
    },
    registry::OwnerRegistry,
    state::{ClientRuntime, CoordinatorInner, CoordinatorMode, OwnerRuntime, SharedWriter},
};

const LOCALHOST: &str = "127.0.0.1";
const ELECTION_RETRY: Duration = Duration::from_millis(300);

pub(super) fn start_election_loop(inner: Arc<Mutex<CoordinatorInner>>, app: AppHandle) {
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

pub(super) fn handle_client_disconnected(inner: Arc<Mutex<CoordinatorInner>>, app: AppHandle) {
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

pub(super) fn send_json_line<T: Serialize>(writer: &SharedWriter, message: &T) -> io::Result<()> {
    let line = serde_json::to_string(message)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    let mut stream = writer.lock();
    stream.write_all(line.as_bytes())?;
    stream.write_all(b"\n")?;
    stream.flush()
}
