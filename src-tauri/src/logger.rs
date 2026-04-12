use log::{Level, LevelFilter, Log, Metadata, Record};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// 保存 AppHandle 供 logger 使用
pub fn set_app_handle(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

#[derive(serde::Serialize, Clone)]
struct LogEvent {
    level: &'static str,
    target: String,
    message: String,
    ts: u64,
}

pub struct FrontendLogger;

impl Log for FrontendLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= Level::Debug
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }

        // 输出到 stderr（终端）
        eprintln!(
            "[{} {}] {}",
            record.level(),
            record.target(),
            record.args()
        );

        // 发送到前端
        if let Some(handle) = APP_HANDLE.get() {
            let event = LogEvent {
                level: match record.level() {
                    Level::Error => "error",
                    Level::Warn => "warn",
                    Level::Info => "info",
                    Level::Debug => "debug",
                    Level::Trace => "trace",
                },
                target: record.target().to_string(),
                message: format!("{}", record.args()),
                ts: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            };
            let _ = handle.emit("repo://log", &event);
        }
    }

    fn flush(&self) {}
}

/// 初始化自定义 logger
pub fn init() {
    log::set_logger(&FrontendLogger).expect("failed to set logger");
    log::set_max_level(LevelFilter::Debug);
}
