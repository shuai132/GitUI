use std::{
    collections::HashMap,
    env,
    ffi::{OsStr, OsString},
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{git::error::GitError, process::configure_background_command};

const MANIFEST_FILE: &str = "plugin.json";
const STATE_FILE: &str = "plugin-state.json";
const SUPPORTED_API_VERSION: u32 = 1;
static BACKEND_COMMAND_CACHE: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginBackend {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PluginPermission {
    Simple(String),
    Detailed {
        id: String,
        #[serde(default)]
        reason: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginCommandContribution {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub enablement: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginMenuContribution {
    pub location: String,
    pub command: String,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginPanelContribution {
    pub id: String,
    pub title: String,
    pub location: String,
    pub entry: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSettingsContribution {
    pub id: String,
    pub title: String,
    pub entry: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginContributes {
    #[serde(default)]
    pub commands: Vec<PluginCommandContribution>,
    #[serde(default)]
    pub menus: Vec<PluginMenuContribution>,
    #[serde(default)]
    pub panels: Vec<PluginPanelContribution>,
    #[serde(default)]
    pub settings: Vec<PluginSettingsContribution>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub api_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub entry: Option<String>,
    #[serde(default)]
    pub backend: Option<PluginBackend>,
    #[serde(default)]
    pub permissions: Vec<PluginPermission>,
    #[serde(default)]
    pub contributes: PluginContributes,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginInfo {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginCommandContext {
    #[serde(default)]
    pub repo_id: Option<String>,
    #[serde(default)]
    pub repo_path: Option<String>,
    #[serde(default)]
    pub selection: Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginCommandResult {
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub refresh: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    #[serde(default)]
    result: Option<PluginCommandResult>,
    #[serde(default)]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    message: String,
}

type PluginState = HashMap<String, bool>;

#[tauri::command]
pub async fn list_plugins(app: AppHandle) -> Result<Vec<PluginInfo>, GitError> {
    scan_plugins(&app)
}

#[tauri::command]
pub async fn install_plugin_from_path(
    path: String,
    app: AppHandle,
) -> Result<PluginInfo, GitError> {
    let source = PathBuf::from(path);
    if !source.is_dir() {
        return Err(GitError::InvalidPath(format!(
            "plugin directory not found: {}",
            source.display()
        )));
    }

    let manifest = read_manifest(&source)?;
    validate_manifest(&manifest)?;

    let root = plugins_root(&app)?;
    fs::create_dir_all(&root)?;
    let target = root.join(&manifest.id);
    let source_canonical = source.canonicalize()?;
    let target_canonical = target.canonicalize().ok();
    if target_canonical.as_ref() == Some(&source_canonical) {
        let mut state = read_state(&app)?;
        state.insert(manifest.id.clone(), true);
        write_state(&app, &state)?;
        return Ok(PluginInfo {
            manifest,
            enabled: true,
            path: target.to_string_lossy().to_string(),
        });
    }

    let transaction_root = plugin_install_transaction_root(&app)?;
    let installed = install_plugin_dir_with(
        &source,
        &target,
        &transaction_root,
        &manifest.id,
        copy_dir,
        |from, to| {
            fs::rename(from, to)?;
            Ok(())
        },
        move_plugin_to_system_trash,
    )?;

    let mut state = read_state(&app)?;
    state.insert(manifest.id.clone(), true);
    write_state(&app, &state)?;

    Ok(PluginInfo {
        manifest: installed,
        enabled: true,
        path: target.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn enable_plugin(plugin_id: String, app: AppHandle) -> Result<(), GitError> {
    ensure_plugin_exists(&app, &plugin_id)?;
    let mut state = read_state(&app)?;
    state.insert(plugin_id, true);
    write_state(&app, &state)
}

#[tauri::command]
pub async fn disable_plugin(plugin_id: String, app: AppHandle) -> Result<(), GitError> {
    ensure_plugin_exists(&app, &plugin_id)?;
    let mut state = read_state(&app)?;
    state.insert(plugin_id, false);
    write_state(&app, &state)
}

#[tauri::command]
pub async fn uninstall_plugin(plugin_id: String, app: AppHandle) -> Result<(), GitError> {
    let dir = plugin_dir(&app, &plugin_id)?;
    uninstall_plugin_dir_with(&dir, move_plugin_to_system_trash)?;
    let mut state = read_state(&app)?;
    state.remove(&plugin_id);
    write_state(&app, &state)
}

fn move_plugin_to_system_trash(path: &Path) -> Result<(), GitError> {
    trash::delete(path)
        .map_err(|error| GitError::OperationFailed(format!("无法将插件移入系统废纸篓: {error}")))
}

fn uninstall_plugin_dir_with<F>(dir: &Path, mut move_to_trash: F) -> Result<(), GitError>
where
    F: FnMut(&Path) -> Result<(), GitError>,
{
    if dir.exists() {
        move_to_trash(dir)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn execute_plugin_command(
    plugin_id: String,
    command_id: String,
    context: PluginCommandContext,
    app: AppHandle,
) -> Result<PluginCommandResult, GitError> {
    let info = load_plugin(&app, &plugin_id)?;
    if !info.enabled {
        return Err(GitError::OperationFailed(format!(
            "插件未启用: {}",
            info.manifest.name
        )));
    }

    let command_exists = info
        .manifest
        .contributes
        .commands
        .iter()
        .any(|command| command.id == command_id);
    if !command_exists {
        return Err(GitError::OperationFailed(format!(
            "插件命令不存在: {command_id}"
        )));
    }

    let Some(backend) = info.manifest.backend.clone() else {
        return Ok(PluginCommandResult {
            message: Some(format!("插件命令已触发: {command_id}")),
            refresh: Vec::new(),
        });
    };

    let plugin_dir = PathBuf::from(info.path);
    tauri::async_runtime::spawn_blocking(move || {
        run_backend_command(&backend, &plugin_dir, &command_id, context)
    })
    .await
    .map_err(|e| GitError::OperationFailed(format!("插件后端任务失败: {e}")))?
}

fn scan_plugins(app: &AppHandle) -> Result<Vec<PluginInfo>, GitError> {
    let root = plugins_root(app)?;
    fs::create_dir_all(&root)?;
    let state = read_state(app)?;
    let mut plugins = Vec::new();

    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest = match read_manifest(&path) {
            Ok(manifest) if validate_manifest(&manifest).is_ok() => manifest,
            _ => continue,
        };
        let enabled = state.get(&manifest.id).copied().unwrap_or(false);
        plugins.push(PluginInfo {
            manifest,
            enabled,
            path: path.to_string_lossy().to_string(),
        });
    }

    plugins.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    Ok(plugins)
}

fn load_plugin(app: &AppHandle, plugin_id: &str) -> Result<PluginInfo, GitError> {
    scan_plugins(app)?
        .into_iter()
        .find(|plugin| plugin.manifest.id == plugin_id)
        .ok_or_else(|| GitError::OperationFailed(format!("插件不存在: {plugin_id}")))
}

fn ensure_plugin_exists(app: &AppHandle, plugin_id: &str) -> Result<(), GitError> {
    let dir = plugin_dir(app, plugin_id)?;
    if dir.join(MANIFEST_FILE).is_file() {
        Ok(())
    } else {
        Err(GitError::OperationFailed(format!(
            "插件不存在: {plugin_id}"
        )))
    }
}

fn plugins_root(app: &AppHandle) -> Result<PathBuf, GitError> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("plugins"))
        .map_err(|e| GitError::OperationFailed(format!("无法读取应用数据目录: {e}")))
}

fn plugin_install_transaction_root(app: &AppHandle) -> Result<PathBuf, GitError> {
    app.path()
        .app_data_dir()
        .map(|path| {
            path.join("plugin-install-transactions")
                .join(uuid::Uuid::new_v4().to_string())
        })
        .map_err(|e| GitError::OperationFailed(format!("无法读取应用数据目录: {e}")))
}

fn plugin_dir(app: &AppHandle, plugin_id: &str) -> Result<PathBuf, GitError> {
    if !is_valid_plugin_id(plugin_id) {
        return Err(GitError::InvalidPath(format!(
            "invalid plugin id: {plugin_id}"
        )));
    }
    Ok(plugins_root(app)?.join(plugin_id))
}

fn state_path(app: &AppHandle) -> Result<PathBuf, GitError> {
    Ok(plugins_root(app)?.join(STATE_FILE))
}

fn read_manifest(path: &Path) -> Result<PluginManifest, GitError> {
    let raw = fs::read_to_string(path.join(MANIFEST_FILE))?;
    serde_json::from_str(&raw)
        .map_err(|e| GitError::OperationFailed(format!("插件 manifest 解析失败: {e}")))
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), GitError> {
    if manifest.api_version != SUPPORTED_API_VERSION {
        return Err(GitError::OperationFailed(format!(
            "不支持的插件 API 版本: {}",
            manifest.api_version
        )));
    }
    if !is_valid_plugin_id(&manifest.id) {
        return Err(GitError::InvalidPath(format!(
            "invalid plugin id: {}",
            manifest.id
        )));
    }
    if manifest.name.trim().is_empty() {
        return Err(GitError::OperationFailed("插件名称不能为空".to_string()));
    }
    Ok(())
}

fn is_valid_plugin_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

fn read_state(app: &AppHandle) -> Result<PluginState, GitError> {
    let path = state_path(app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = fs::read_to_string(path)?;
    serde_json::from_str(&raw)
        .map_err(|e| GitError::OperationFailed(format!("插件状态解析失败: {e}")))
}

fn write_state(app: &AppHandle, state: &PluginState) -> Result<(), GitError> {
    let path = state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(state)
        .map_err(|e| GitError::OperationFailed(format!("插件状态序列化失败: {e}")))?;
    fs::write(path, raw)?;
    Ok(())
}

fn copy_dir(source: &Path, target: &Path) -> Result<(), GitError> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir(&source_path, &target_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn cleanup_install_transaction(transaction_root: &Path) {
    if transaction_root.exists() {
        let _ = fs::remove_dir_all(transaction_root);
    }
}

fn install_plugin_dir_with<C, R, T>(
    source: &Path,
    target: &Path,
    transaction_root: &Path,
    expected_id: &str,
    mut copy: C,
    mut rename: R,
    mut move_to_trash: T,
) -> Result<PluginManifest, GitError>
where
    C: FnMut(&Path, &Path) -> Result<(), GitError>,
    R: FnMut(&Path, &Path) -> Result<(), GitError>,
    T: FnMut(&Path) -> Result<(), GitError>,
{
    fs::create_dir_all(transaction_root)?;
    let staged = transaction_root.join("new");
    let backup = transaction_root.join(expected_id);

    if let Err(error) = copy(source, &staged) {
        cleanup_install_transaction(transaction_root);
        return Err(error);
    }

    let staged_manifest = match read_manifest(&staged).and_then(|manifest| {
        validate_manifest(&manifest)?;
        if manifest.id != expected_id {
            return Err(GitError::OperationFailed(format!(
                "插件复制期间 ID 发生变化: 预期 {expected_id}，实际 {}",
                manifest.id
            )));
        }
        Ok(manifest)
    }) {
        Ok(manifest) => manifest,
        Err(error) => {
            cleanup_install_transaction(transaction_root);
            return Err(error);
        }
    };

    if !target.exists() {
        if let Err(error) = rename(&staged, target) {
            cleanup_install_transaction(transaction_root);
            return Err(GitError::OperationFailed(format!(
                "无法启用新插件目录: {error}"
            )));
        }
        cleanup_install_transaction(transaction_root);
        return Ok(staged_manifest);
    }

    if let Err(error) = rename(target, &backup) {
        cleanup_install_transaction(transaction_root);
        return Err(GitError::OperationFailed(format!(
            "无法暂存现有插件版本: {error}"
        )));
    }

    if let Err(error) = rename(&staged, target) {
        let rollback = rename(&backup, target);
        if rollback.is_ok() {
            cleanup_install_transaction(transaction_root);
            return Err(GitError::OperationFailed(format!(
                "无法切换到新插件版本，已恢复旧版本: {error}"
            )));
        }
        return Err(GitError::OperationFailed(format!(
            "无法切换到新插件版本，且自动恢复失败；旧版本保留在 {}: {error}; {}",
            backup.display(),
            rollback.unwrap_err()
        )));
    }

    if let Err(error) = move_to_trash(&backup) {
        let rejected = transaction_root.join("rejected-new");
        let move_new = rename(target, &rejected);
        if let Err(move_error) = move_new {
            return Err(GitError::OperationFailed(format!(
                "无法回收旧插件版本，且无法开始回滚；旧版本保留在 {}: {error}; {move_error}",
                backup.display()
            )));
        }

        match rename(&backup, target) {
            Ok(()) => {
                cleanup_install_transaction(transaction_root);
                return Err(GitError::OperationFailed(format!(
                    "无法回收旧插件版本，已恢复旧版本: {error}"
                )));
            }
            Err(restore_error) => {
                let preserve_new = rename(&rejected, target);
                return Err(GitError::OperationFailed(format!(
                    "无法回收旧插件版本，且自动恢复失败；旧版本保留在 {}: {error}; {restore_error}; 新版本恢复结果: {}",
                    backup.display(),
                    if preserve_new.is_ok() { "已保留" } else { "失败" }
                )));
            }
        }
    }

    cleanup_install_transaction(transaction_root);
    Ok(staged_manifest)
}

fn run_backend_command(
    backend: &PluginBackend,
    plugin_dir: &Path,
    command_id: &str,
    context: PluginCommandContext,
) -> Result<PluginCommandResult, GitError> {
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "execute_command",
        "params": {
            "command_id": command_id,
            "context": context,
        },
    });

    let mut child = spawn_backend_child(backend, plugin_dir).map_err(|e| {
        GitError::OperationFailed(format!(
            "插件后端启动失败 {}: {}",
            backend.command,
            format_backend_spawn_error(&e)
        ))
    })?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(request.to_string().as_bytes())?;
        stdin.write_all(b"\n")?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| GitError::OperationFailed(format!("插件后端执行失败: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(GitError::OperationFailed(format!(
            "插件后端退出失败: {detail}"
        )));
    }

    if stdout.is_empty() {
        return Ok(PluginCommandResult::default());
    }

    if let Ok(response) = serde_json::from_str::<JsonRpcResponse>(&stdout) {
        if let Some(error) = response.error {
            return Err(GitError::OperationFailed(error.message));
        }
        return Ok(response.result.unwrap_or_default());
    }

    if let Ok(result) = serde_json::from_str::<PluginCommandResult>(&stdout) {
        return Ok(result);
    }

    Ok(PluginCommandResult {
        message: Some(stdout),
        refresh: Vec::new(),
    })
}

fn spawn_backend_child(backend: &PluginBackend, plugin_dir: &Path) -> io::Result<Child> {
    if let Some(resolved) = cached_backend_command(&backend.command) {
        match build_backend_command(&resolved, backend, plugin_dir).spawn() {
            Ok(child) => return Ok(child),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                forget_backend_command(&backend.command);
            }
            Err(error) => return Err(error),
        }
    }

    let first_result = build_backend_command(&backend.command, backend, plugin_dir).spawn();

    match first_result {
        Ok(child) => Ok(child),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if let Some(resolved) = resolve_backend_command(&backend.command) {
                remember_backend_command(&backend.command, resolved.clone());
                return build_backend_command(resolved, backend, plugin_dir).spawn();
            }
            Err(error)
        }
        Err(error) => Err(error),
    }
}

fn build_backend_command<S>(command: S, backend: &PluginBackend, plugin_dir: &Path) -> Command
where
    S: AsRef<OsStr>,
{
    let mut child = Command::new(command);
    child
        .args(&backend.args)
        .current_dir(plugin_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_background_command(&mut child);
    child
}

fn resolve_backend_command(command: &str) -> Option<PathBuf> {
    let command_path = Path::new(command);
    if command_path.is_absolute() || command_path.components().count() > 1 {
        return None;
    }

    find_command_in_path(command, env::var_os("PATH"))
        .or_else(|| find_command_in_nvm(command))
        .or_else(|| resolve_command_with_user_shell(command))
}

fn find_command_in_path(command: &str, path_env: Option<OsString>) -> Option<PathBuf> {
    let path_env = path_env?;
    env::split_paths(&path_env)
        .map(|dir| dir.join(command))
        .find(|candidate| candidate.is_file())
}

fn find_command_in_nvm(command: &str) -> Option<PathBuf> {
    let versions_dir = env::var_os("NVM_DIR")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".nvm")))?
        .join("versions")
        .join("node");

    find_command_in_nvm_versions_dir(command, &versions_dir)
}

fn find_command_in_nvm_versions_dir(command: &str, versions_dir: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for entry in fs::read_dir(versions_dir).ok()? {
        let entry = entry.ok()?;
        let Some(version) = parse_nvm_node_version(&entry.file_name().to_string_lossy()) else {
            continue;
        };
        let candidate = entry.path().join("bin").join(command);
        if candidate.is_file() {
            candidates.push((version, candidate));
        }
    }

    candidates
        .into_iter()
        .max_by_key(|(version, _)| *version)
        .map(|(_, path)| path)
}

fn parse_nvm_node_version(value: &str) -> Option<(u64, u64, u64)> {
    let mut parts = value.strip_prefix('v')?.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

#[cfg(unix)]
fn resolve_command_with_user_shell(command: &str) -> Option<PathBuf> {
    let shell = env::var_os("SHELL")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| OsString::from("/bin/zsh"));

    let output = Command::new(shell)
        .arg("-ic")
        .arg("command -v -- \"$1\"")
        .arg("_")
        .arg(command)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .map(PathBuf::from)
        .find(|candidate| candidate.is_absolute() && candidate.is_file())
}

#[cfg(not(unix))]
fn resolve_command_with_user_shell(_command: &str) -> Option<PathBuf> {
    None
}

fn format_backend_spawn_error(error: &io::Error) -> String {
    if error.kind() == io::ErrorKind::NotFound {
        format!(
            "{error}. release 应用可能无法读取终端 PATH；请在 plugin.json 使用后端命令绝对路径，或把命令加入系统 PATH"
        )
    } else {
        error.to_string()
    }
}

fn backend_command_cache() -> &'static Mutex<HashMap<String, PathBuf>> {
    BACKEND_COMMAND_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached_backend_command(command: &str) -> Option<PathBuf> {
    backend_command_cache().lock().ok()?.get(command).cloned()
}

fn remember_backend_command(command: &str, resolved: PathBuf) {
    if let Ok(mut cache) = backend_command_cache().lock() {
        cache.insert(command.to_string(), resolved);
    }
}

fn forget_backend_command(command: &str) {
    if let Ok(mut cache) = backend_command_cache().lock() {
        cache.remove(command);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, env, ffi::OsString, fs};

    fn base_manifest() -> PluginManifest {
        PluginManifest {
            api_version: SUPPORTED_API_VERSION,
            id: "com.example.demo".to_string(),
            name: "Demo".to_string(),
            version: "0.1.0".to_string(),
            description: None,
            entry: None,
            backend: None,
            permissions: Vec::new(),
            contributes: PluginContributes::default(),
        }
    }

    fn write_plugin_fixture(path: &Path, version: &str, marker: &str) {
        fs::create_dir_all(path).unwrap();
        let mut manifest = base_manifest();
        manifest.version = version.to_string();
        fs::write(
            path.join(MANIFEST_FILE),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(path.join("marker.txt"), marker).unwrap();
    }

    #[test]
    fn validates_supported_manifest() {
        let manifest = base_manifest();
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn rejects_unsupported_api_version() {
        let mut manifest = base_manifest();
        manifest.api_version = SUPPORTED_API_VERSION + 1;
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn rejects_invalid_plugin_id() {
        let mut manifest = base_manifest();
        manifest.id = "../bad".to_string();
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn finds_backend_command_in_supplied_path() {
        let temp_dir = tempfile::tempdir().unwrap();
        let executable = temp_dir.path().join("demo-command");
        fs::write(&executable, "").unwrap();

        let path_env = env::join_paths([temp_dir.path()]).unwrap();

        assert_eq!(
            find_command_in_path("demo-command", Some(path_env)),
            Some(executable)
        );
    }

    #[test]
    fn does_not_find_backend_command_without_path_entries() {
        assert!(find_command_in_path("demo-command", Some(OsString::new())).is_none());
    }

    #[test]
    fn finds_latest_nvm_backend_command() {
        let temp_dir = tempfile::tempdir().unwrap();
        let old_bin = temp_dir.path().join("v20.1.0").join("bin");
        let new_bin = temp_dir.path().join("v24.15.0").join("bin");
        fs::create_dir_all(&old_bin).unwrap();
        fs::create_dir_all(&new_bin).unwrap();
        fs::write(old_bin.join("node"), "").unwrap();
        fs::write(new_bin.join("node"), "").unwrap();

        assert_eq!(
            find_command_in_nvm_versions_dir("node", temp_dir.path()),
            Some(new_bin.join("node"))
        );
    }

    #[test]
    fn parses_nvm_node_versions_numerically() {
        assert_eq!(parse_nvm_node_version("v24.15.0"), Some((24, 15, 0)));
        assert_eq!(parse_nvm_node_version("v9.99.99"), Some((9, 99, 99)));
        assert!(parse_nvm_node_version("system").is_none());
    }

    #[test]
    fn caches_resolved_backend_command() {
        let command = "gitui-test-cached-command";
        let resolved = PathBuf::from("/tmp/gitui-test-cached-command");

        forget_backend_command(command);
        assert!(cached_backend_command(command).is_none());

        remember_backend_command(command, resolved.clone());
        assert_eq!(cached_backend_command(command), Some(resolved));

        forget_backend_command(command);
        assert!(cached_backend_command(command).is_none());
    }

    #[test]
    fn parses_simple_and_detailed_permissions() {
        let raw = r#"{
            "api_version": 1,
            "id": "com.example.demo",
            "name": "Demo",
            "version": "0.1.0",
            "permissions": [
                "git:read",
                { "id": "process:run", "reason": "Run project checks" }
            ],
            "contributes": {
                "commands": [
                    { "id": "demo.run", "label": "Run demo" }
                ],
                "menus": [
                    { "location": "toolbar.actions", "command": "demo.run" }
                ]
            }
        }"#;

        let manifest: PluginManifest = serde_json::from_str(raw).unwrap();
        assert_eq!(manifest.permissions.len(), 2);
        assert_eq!(manifest.contributes.commands[0].id, "demo.run");
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn parses_json_rpc_command_result() {
        let raw = r#"{
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "message": "done",
                "refresh": ["workspace", "history"]
            }
        }"#;

        let response: JsonRpcResponse = serde_json::from_str(raw).unwrap();
        let result = response.result.unwrap();
        assert_eq!(result.message.as_deref(), Some("done"));
        assert_eq!(result.refresh, vec!["workspace", "history"]);
    }

    #[test]
    fn replacement_installs_staged_plugin_and_retires_old_copy() {
        let temp_dir = tempfile::tempdir().unwrap();
        let source = temp_dir.path().join("source");
        let target = temp_dir.path().join("plugins/com.example.demo");
        let transaction = temp_dir.path().join("transactions/install");
        let recovery = temp_dir.path().join("recovery");
        write_plugin_fixture(&source, "2.0.0", "new");
        write_plugin_fixture(&target, "1.0.0", "old");

        let installed = install_plugin_dir_with(
            &source,
            &target,
            &transaction,
            "com.example.demo",
            copy_dir,
            |from, to| {
                fs::rename(from, to)?;
                Ok(())
            },
            |backup| {
                fs::rename(backup, &recovery)?;
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(installed.version, "2.0.0");
        assert_eq!(
            fs::read_to_string(target.join("marker.txt")).unwrap(),
            "new"
        );
        assert_eq!(
            fs::read_to_string(recovery.join("marker.txt")).unwrap(),
            "old"
        );
        assert!(!transaction.exists());
    }

    #[test]
    fn replacement_keeps_old_plugin_when_copy_fails() {
        let temp_dir = tempfile::tempdir().unwrap();
        let source = temp_dir.path().join("source");
        let target = temp_dir.path().join("plugins/com.example.demo");
        let transaction = temp_dir.path().join("transactions/install");
        write_plugin_fixture(&source, "2.0.0", "new");
        write_plugin_fixture(&target, "1.0.0", "old");

        let result = install_plugin_dir_with(
            &source,
            &target,
            &transaction,
            "com.example.demo",
            |_, staged| {
                fs::create_dir_all(staged)?;
                fs::write(staged.join("partial"), "partial")?;
                Err(GitError::OperationFailed("copy failed".to_string()))
            },
            |from, to| {
                fs::rename(from, to)?;
                Ok(())
            },
            |_| Ok(()),
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(target.join("marker.txt")).unwrap(),
            "old"
        );
        assert!(!transaction.exists());
    }

    #[test]
    fn replacement_restores_old_plugin_when_switch_fails() {
        let temp_dir = tempfile::tempdir().unwrap();
        let source = temp_dir.path().join("source");
        let target = temp_dir.path().join("plugins/com.example.demo");
        let transaction = temp_dir.path().join("transactions/install");
        write_plugin_fixture(&source, "2.0.0", "new");
        write_plugin_fixture(&target, "1.0.0", "old");
        let rename_count = Cell::new(0);

        let result = install_plugin_dir_with(
            &source,
            &target,
            &transaction,
            "com.example.demo",
            copy_dir,
            |from, to| {
                rename_count.set(rename_count.get() + 1);
                if rename_count.get() == 2 {
                    return Err(GitError::OperationFailed("switch failed".to_string()));
                }
                fs::rename(from, to)?;
                Ok(())
            },
            |_| Ok(()),
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(target.join("marker.txt")).unwrap(),
            "old"
        );
        assert!(!transaction.exists());
    }

    #[test]
    fn replacement_restores_old_plugin_when_trash_fails() {
        let temp_dir = tempfile::tempdir().unwrap();
        let source = temp_dir.path().join("source");
        let target = temp_dir.path().join("plugins/com.example.demo");
        let transaction = temp_dir.path().join("transactions/install");
        write_plugin_fixture(&source, "2.0.0", "new");
        write_plugin_fixture(&target, "1.0.0", "old");

        let result = install_plugin_dir_with(
            &source,
            &target,
            &transaction,
            "com.example.demo",
            copy_dir,
            |from, to| {
                fs::rename(from, to)?;
                Ok(())
            },
            |_| Err(GitError::OperationFailed("trash failed".to_string())),
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(target.join("marker.txt")).unwrap(),
            "old"
        );
        assert!(!transaction.exists());
    }

    #[test]
    fn replacement_rejects_manifest_id_changed_during_copy() {
        let temp_dir = tempfile::tempdir().unwrap();
        let source = temp_dir.path().join("source");
        let target = temp_dir.path().join("plugins/com.example.demo");
        let transaction = temp_dir.path().join("transactions/install");
        write_plugin_fixture(&source, "2.0.0", "new");
        write_plugin_fixture(&target, "1.0.0", "old");

        let result = install_plugin_dir_with(
            &source,
            &target,
            &transaction,
            "com.example.changed",
            copy_dir,
            |from, to| {
                fs::rename(from, to)?;
                Ok(())
            },
            |_| Ok(()),
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(target.join("marker.txt")).unwrap(),
            "old"
        );
        assert!(!transaction.exists());
    }

    #[test]
    fn uninstall_moves_plugin_directory_before_completing() {
        let temp_dir = tempfile::tempdir().unwrap();
        let plugin_dir = temp_dir.path().join("plugin");
        let recovery_dir = temp_dir.path().join("recovery");
        fs::create_dir(&plugin_dir).unwrap();
        fs::write(plugin_dir.join(MANIFEST_FILE), "{}").unwrap();

        uninstall_plugin_dir_with(&plugin_dir, |source| {
            fs::rename(source, &recovery_dir)?;
            Ok(())
        })
        .unwrap();

        assert!(!plugin_dir.exists());
        assert!(recovery_dir.join(MANIFEST_FILE).is_file());
    }

    #[test]
    fn uninstall_keeps_plugin_directory_when_trash_fails() {
        let temp_dir = tempfile::tempdir().unwrap();
        let plugin_dir = temp_dir.path().join("plugin");
        fs::create_dir(&plugin_dir).unwrap();

        let result = uninstall_plugin_dir_with(&plugin_dir, |_| {
            Err(GitError::OperationFailed("trash unavailable".to_string()))
        });

        assert!(result.is_err());
        assert!(plugin_dir.is_dir());
    }
}
