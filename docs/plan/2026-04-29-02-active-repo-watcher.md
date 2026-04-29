# 激活仓库独占 Watcher

## Context

当前每次 `open_repo` 都会为仓库注册文件系统 watcher，切换激活仓库只在前端过滤事件，导致非激活仓库仍在后台监听并产生无效事件。

目标是同一窗口内只监听当前激活仓库。切到 B 仓库时停止 A 的 watcher，启动 B 的 watcher；无激活仓库时停止所有 watcher。切回仓库时由现有激活刷新流程重新加载状态。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 1 | 完成 | 确认 watcher 生命周期与切仓库数据流 |
| 2 | 完成 | 后端改为激活仓库独占 watcher |
| 3 | 完成 | 前端切换激活仓库时同步后端 |
| 4 | 完成 | 文档与测试检查 |

## 子任务清单

- [x] 移除 `open_repo` 中的 watcher 自动注册。
- [x] 新增 `set_active_repo` IPC，同步 watcher 与 auto-fetch 的目标仓库。
- [x] `WatcherService` 支持独占切换与全部停止。
- [x] 前端 active repo watch 改调 `set_active_repo`。
- [x] 更新仓库管理与 IPC 文档。
- [x] 运行类型、编译与单元测试检查。

## 关键决策

- **非激活仓库不监听**：只保留名册与前端视图缓存，不为了缓存新鲜度牺牲后台资源。
- **切换时先停旧 watcher**：即使新 watcher 启动失败，也不继续监听已经非激活的旧仓库。
- **复用激活同步入口**：`set_active_repo` 同时驱动 watcher 与 auto-fetch，避免前端维护两套后端激活状态。

## 验证方式

- 前端：`npx vue-tsc --noEmit`、`npm run test`。
- 后端：`cd src-tauri && cargo fmt`、`cargo check`、`cargo test`。
- 手动验证：打开 A 和 B，激活 B 后修改 A，不应触发 A 的工作区/历史刷新；切回 A 后刷新正常。
