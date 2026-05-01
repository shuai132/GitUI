use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::git::error::GitError;

const MANIFEST_FILE: &str = "plugin.json";
const STATE_FILE: &str = "plugin-state.json";
const SUPPORTED_API_VERSION: u32 = 1;

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
    if target.exists() {
        fs::remove_dir_all(&target)?;
    }
    copy_dir(&source, &target)?;

    let mut state = read_state(&app)?;
    state.insert(manifest.id.clone(), true);
    write_state(&app, &state)?;

    let installed = read_manifest(&target)?;
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
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    let mut state = read_state(&app)?;
    state.remove(&plugin_id);
    write_state(&app, &state)
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

    let mut child = Command::new(&backend.command)
        .args(&backend.args)
        .current_dir(plugin_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            GitError::OperationFailed(format!("插件后端启动失败 {}: {e}", backend.command))
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
