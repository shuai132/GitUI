use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows GUI 应用启动后台控制台程序时，禁止系统创建可见控制台窗口。
///
/// 仅用于无需用户交互的后台进程；外部终端、安装器等显式 UI 不应调用此函数。
pub fn configure_background_command(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW

    #[cfg(not(windows))]
    let _ = command;
}
