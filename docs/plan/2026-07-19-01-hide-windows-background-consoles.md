# 隐藏 Windows 后台子进程控制台

## Context

Windows GUI 应用启动控制台子进程时，如果创建参数没有明确禁止控制台窗口，用户可能看到短暂黑框。GitUI 已覆盖直接启动的 Git / SSH 进程，但 `git2-rs 0.19` 内部启动 credential helper 以及插件后端进程仍存在遗漏。

预期结果是所有非交互后台子进程在 Windows 上静默运行；用户明确要求打开的外部终端和更新安装界面继续正常显示。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 1 | 已完成 | 统一后台进程的 Windows 隐藏配置 |
| 2 | 已完成 | 升级 `git2-rs`，覆盖 credential helper |
| 3 | 已完成 | 更新设计文档并完成全量验证 |

## 子任务清单

- [x] 新增统一后台进程配置并迁移 Git / SSH shellout。
- [x] 插件后端进程应用 Windows 隐藏配置。
- [x] 将 `git2-rs` 升级到包含 credential helper 隐藏修复的稳定版本。
- [x] 保留外部终端和更新安装器的可见交互。
- [x] 更新远程与插件设计文档。
- [x] 运行格式化、前端类型检查与前后端全部单元测试。

## 关键决策

- **统一处理后台进程**：由共享模块设置 Windows `CREATE_NO_WINDOW`，避免每个功能域复制常量并再次遗漏。
- **使用上游修复覆盖 credential helper**：升级 `git2-rs`，不维护本地 fork，也不重新实现 Git credential 协议。
- **不隐藏显式终端和安装器**：这些窗口是用户主动请求的交互界面，不属于后台黑框。
- **不改变 Git 网络行为**：远程 Tag、Fetch、Push、Pull 的触发条件与数据流保持不变。

## 验证方式

- `cd src-tauri && cargo fmt -- --check`
- `npx vue-tsc --noEmit`
- `npm run test`
- `cd src-tauri && cargo check`
- `cd src-tauri && cargo test`
- Windows 手动验证：空闲运行、远程 Tag 查询、HTTPS credential helper、SSH 操作和插件后端均不闪控制台；“在终端打开”仍显示终端。
