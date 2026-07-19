# 托盘协调器模块拆分

## Context

`src-tauri/src/tray.rs` 当前同时承载托盘公开入口、owner / client 状态、跨进程协议、TCP transport、registry、Tauri 托盘菜单和单元测试。文件体量过大，后续无论是继续收敛 TCP 协议，还是评估共享内存 / 轻量状态层，都会让行为变更和结构调整混在一起。

本次只做无行为变化的模块化重构：保留 `tray::TrayCoordinator`、`tray::LocalWindowCloseAction` 和 `tray::setup_tray` 对外 API，把内部职责拆到 `src-tauri/src/tray/` 子模块中，降低后续维护成本。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 1 | 已完成 | 拆分 plan 与模块边界确认 |
| 2 | 已完成 | 拆分 coordinator / state / registry / protocol / transport / menu |
| 3 | 已完成 | 迁移现有单元测试到对应模块 |
| 4 | 已完成 | 格式化并运行 Rust 验证 |

## 子任务清单

- [x] 保留 `src-tauri/src/tray.rs` 作为模块根，维持原公开 API。
- [x] 新增 `state.rs` 管理 coordinator 内部状态、runtime 和 action 类型。
- [x] 新增 `registry.rs` 管理窗口 registry、菜单 entry 和相关测试。
- [x] 新增 `protocol.rs` 管理 owner state 与 owner/client message。
- [x] 新增 `transport.rs` 管理 owner/client 连接、JSON line 收发和选主。
- [x] 新增 `menu.rs` 管理 Tauri 托盘菜单、图标和本地窗口显示。
- [x] 删除旧的单文件 `tray.rs` 实现，收缩为模块根。
- [x] 运行 `cargo fmt`、`cargo check` 和相关测试。

## 关键决策

- 本次不改变托盘 owner 协议、不改 IPC 契约、不改窗口关闭语义，只移动代码边界。
- 对外仍保持 `crate::tray` 模块路径，避免波及 `lib.rs` 和 `commands/repo.rs`。
- 子模块之间用 `pub(super)` 暴露内部类型和函数，避免把协议、registry、transport 泄露到 crate 级 API。
- 测试跟随被测对象迁移：registry 测试放在 `registry.rs`，owner state 读写测试放在 `protocol.rs`。

## 验证方式

- `cd src-tauri && cargo fmt`
- `cd src-tauri && cargo check`
- `cd src-tauri && cargo test tray`
- 如时间允许，补跑 `cd src-tauri && cargo test`
