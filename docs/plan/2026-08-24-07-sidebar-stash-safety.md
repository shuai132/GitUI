# 统一侧边栏 Stash 安全操作

## Context

GitUI 工具栏在脏工作区 Pop 最新 Stash 时已经展示目标与本地改动确认，历史图删除 Stash 也会携带 commit OID 防止确认期间栈重排；侧边栏的同类操作仍是旧路径：Pop 直接执行，Delete 使用系统 `confirm()`，两者都只按可变化的 stash index 操作。

Git 官方文档明确说明，误 Drop / Clear 的 Stash 无法通过常规安全机制恢复；GitKraken 也把 Delete Stash 定义为永久移除。预期结果：侧边栏 Pop 在脏工作区先显示应用内确认，Delete 始终显示不可恢复警告；执行时携带用户点中条目的 commit OID，并在仓库上下文变化时取消旧请求。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 现状与依据核对 | 已完成 | 确认侧边栏绕过工具栏 / 历史图已有保护 |
| 交互实现 | 已完成 | 为 Pop 与 Delete 接入统一应用内确认 |
| 测试与文档 | 已完成 | 覆盖 clean、dirty、Drop 与上下文变化 |
| 验证与交付 | 已完成 | 已完成全量检查、提交并推送 |

## 子任务清单

- [x] 核对侧边栏、工具栏、历史图三条 Stash 操作路径
- [x] 核对 `stash_pop` / `stash_drop` 的 `expected_oid` 契约
- [x] clean 工作区 Pop 保持一步执行，但携带目标 OID
- [x] dirty 工作区 Pop 显示本地改动数、stash 序号与消息
- [x] Delete 使用应用内危险确认并说明常规恢复限制
- [x] 确认期间仓库变化时取消请求，不操作新仓库
- [x] 失败反馈改为非阻塞全局提示，不再调用系统 `alert()`
- [x] 覆盖关键交互与目标参数测试
- [x] 更新中英文文案与 Stash 设计文档
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- Pop 只在当前工作区已有 staged、unstaged 或 untracked 项时增加确认；clean 工作区不增加点击成本。
- Pop 和 Delete 都捕获 `repoId`、index、消息与 commit OID；后端以 OID 拒绝已经因外部命令重排到该 index 的其他条目。
- 上下文校验以确认时的 active repo 为准；仓库已切换则关闭旧对话框并提示重新选择。
- Pop 确认明确说明重叠改动可能产生冲突，以及 Pop 未完成时 Stash 会保留；不把风险模糊成通用“是否继续”。
- Apply 保持现状：它不会删除 Stash，且本次不扩大 IPC 契约为其新增目标守卫。
- 不尝试自动恢复已删除 Stash；Git 对象回收时机不稳定，可靠的产品承诺应是删除前防错。

## 验证方式

1. clean 工作区从侧边栏 Pop，确认不弹窗且请求携带点中条目的 OID。
2. dirty 工作区从侧边栏 Pop，确认对话框显示唯一改动路径数、stash 序号与消息。
3. 确认 Pop，确认执行目标与对话框捕获目标一致；取消时不执行。
4. 删除任意 Stash，确认危险对话框说明常规恢复限制并携带目标 OID。
5. 对话框打开后切换仓库，确认旧请求被取消并显示非阻塞错误提示。
6. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
