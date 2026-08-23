# 历史操作应用内确认

## Context

历史提交右键菜单的 Checkout、Cherry-pick、Revert、Reset 和删除 Stash 都依赖 WebView 原生 `confirm()`。仓库既有方案记录了 macOS Tauri 环境中原生确认框偶发被吞、操作表现为静默无反应的问题；同时原确认文案没有统一展示提交摘要、SHA、当前分支和 Reset 模式。

GitKraken 对 Hard Reset 等危险操作使用验证提示，并明确区分 soft / mixed / hard 对工作区的影响；GitHub Desktop 对丢弃改动使用应用内确认窗口展示影响范围。预期结果：上述已有历史操作统一使用 GitUI 的 `ConfirmDialog`，目标和后果可见、执行中不可重复提交，错误进入统一 Toast。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 竞品与现状核对 | 已完成 | 确认原生对话框失效记录与竞品危险操作确认方式 |
| 确认流程 | 已完成 | 五类操作使用统一挂起状态、目标快照与执行入口 |
| 安全边界 | 已完成 | 前后端校验 repo、HEAD OID / ref 与 Stash OID |
| 文档与验证 | 已完成 | 已同步历史 / Stash / IPC 契约，全量检查通过 |

## 子任务清单

- [x] 盘点历史提交右键菜单中的原生确认和错误弹窗
- [x] 核对 GitKraken Reset 与 GitHub Desktop 危险操作确认交互
- [x] 用应用内确认框覆盖 Checkout、Cherry-pick、Revert、三种 Reset 和删除 Stash
- [x] 文案展示提交摘要、短 SHA、分支 / Reset 模式或 Stash 消息
- [x] 确认期间禁用关闭和重复提交
- [x] 仓库或 HEAD 变化时取消旧的提交操作请求
- [x] 删除 Stash 时以 commit OID 复核 index 目标
- [x] 操作失败通过统一 Toast 展示，不再使用原生 `alert()`
- [x] 覆盖确认展示、取消、执行、上下文变化与 Stash OID 防护测试
- [x] 更新历史、Stash、IPC 文档
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，准备提交并推送 `dev`

## 关键决策

- 先聚焦历史提交菜单，不在同一改动中替换侧边栏、工作区等其他模块的原生对话框，避免跨功能域大爆炸。
- 挂起请求保存仓库、HEAD OID、分支 ref 与目标提交快照；确认时上下文不一致就取消。OID 与 ref 必须同时校验，因为两个分支可能恰好指向同一提交。
- Stash 的 index 会随栈变化重排，因此删除请求同时保存 commit OID，并交给后端在 Drop 前复核；只保存 index 不足以表达用户确认的目标。
- Checkout、Cherry-pick、Revert、soft / mixed reset 使用普通主按钮；Hard Reset 与删除 Stash 使用危险按钮，视觉强度与不可逆程度一致。
- 执行失败沿用全局错误映射和 Toast，不在新的应用内确认流程中保留 WebView 原生 `alert()`。

## 验证方式

1. 分别触发 Checkout、Cherry-pick、Revert 和三种 Reset，确认应用内对话框展示准确目标及后果，取消不执行。
2. 确认各操作执行中按钮进入 loading 且无法关闭 / 重复提交，完成后对话框关闭。
3. 打开确认后切换仓库或让 HEAD 变化，确认旧请求取消且没有 Git 写操作。
4. 对 Stash 删除打开确认后从外部改变栈，再确认，确认目标变化提示可见且没有删除新 index 对应的条目。
5. 让 Git 操作失败，确认统一 Toast 可见且没有原生浏览器弹窗。
6. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
