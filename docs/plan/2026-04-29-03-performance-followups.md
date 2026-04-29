# 性能与可用性后续优化

## Context

本轮检查发现几个收益明确的优化点：工作区状态刷新会读取未跟踪文件内容，watcher 事件后刷新粒度偏粗，普通历史加载会做不必要的可达性分析，Fetch All 会吞掉部分远程错误，快捷键设置里部分动作尚未真正派发。

目标是按独立主题逐步优化并分步提交，每一步保持行为可验证、回归面可控。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| P0 | 完成 | 写入总体计划并单独提交 |
| P1 | 完成 | 优化 `get_status`，避免状态刷新读取未跟踪文件内容 |
| P2 | 完成 | 细化 watcher 事件类别，减少不必要的 history / tags / stash / submodules 刷新 |
| P3 | 待开始 | 优化普通 `get_log` 路径，只有显示丢失引用时才构建可达性集合 |
| P4 | 待开始 | 修复 Fetch All / Fetch Tags All 静默吞掉部分 remote 错误 |
| P5 | 待开始 | 补齐快捷键派发，并清理过期 pending plan 状态 |

## 子任务清单

- [x] P0：提交本计划文档。
- [x] P1：调整后端状态统计策略，让未跟踪文件在状态列表中保持轻量；需要更新 `docs/03-workspace.md`。
- [x] P2：扩展 watcher 事件 payload，按 worktree / index / refs / config 等类别驱动前端刷新；需要更新 `docs/02-repo-management.md` 和 `docs/11-ipc.md`。
- [ ] P3：重构历史日志可达性分析，仅在 `include_unreachable` 需要时执行；需要覆盖普通日志和显示丢失引用两种路径。
- [ ] P4：聚合全部远程 fetch 的成功/失败结果，部分失败时给出包含 remote 名的错误。
- [ ] P5：让设置页展示的 prev/next commit 等快捷键真正可用；同步修正 `docs/plan/2026-04-19-01-pending-improvements.md` 中已过期状态。

## 关键决策

- **分步提交**：P0 只提交计划；P1-P5 每个主题独立提交，便于回滚和定位回归。
- **优先性能热路径**：先处理状态刷新、watcher 刷新和普通日志加载，再处理远程错误与快捷键体验。
- **不牺牲可见行为**：状态列表可减少未跟踪行数统计，但选中文件后的 diff 仍按需展示完整内容。
- **刷新分类保守落地**：事件分类以减少明显无关刷新为目标；拿不准的 `.git` 事件仍归入 refs/config 类别触发完整刷新，避免漏更新。

## 验证方式

- 每个实现提交前运行：`npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo fmt`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
- 手动验证：打开大仓库频繁保存工作区文件，确认 WIP/diff 仍刷新，普通保存不再反复刷新 tags/stash/submodules；Fetch All 中故意配置一个失败 remote，确认 UI 能提示失败 remote。
