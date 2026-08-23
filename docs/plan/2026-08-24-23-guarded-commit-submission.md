# Guarded Commit Submission

## Context

普通 Commit、工作区 Amend 与历史 HEAD Reword 在写入前都重新读取当前 HEAD；即使前端曾检查仓库，外部引用移动或多仓库切换仍可能让请求改写新的提交。提交框在 Merge / Rebase 等中间态也保持可用，可能绕过专用 Continue 流程创建错误父链。目标是让所有直接写 HEAD 的提交入口绑定精确 HEAD OID / ref，并在后端统一要求仓库处于 clean 状态。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 方案与契约 | 已完成 | 定义提交 HEAD 上下文与中间态边界 |
| 后端保护 | 已完成 | Commit / Amend / Reword 写入前复核 |
| 前端流程 | 已完成 | 显式 repoId、HEAD/ref 与禁用状态 |
| 测试与文档 | 已完成 | 覆盖引用漂移、跨仓库和中间态 |
| 全量验证 | 已完成 | 前后端类型、测试和编译检查 |

## 子任务清单

- [x] WorkspaceStatus 提供包含 unborn / detached 的规范 HEAD ref
- [x] create / amend / amend-message IPC 必须携带预期 HEAD OID / ref
- [x] 后端在读取 Index 或创建 commit 前要求 clean 并复核 HEAD
- [x] 工作区 store 提交到捕获的 repoId，刷新不污染其他仓库
- [x] 历史 HEAD Reword 绑定对话框打开时的 repoId 与 HEAD/ref
- [x] Merge / Rebase 等中间态禁用普通提交表单
- [x] 增加 Rust、store 与组件测试
- [x] 更新 `docs/03-workspace.md`、`docs/04-history.md` 与 `docs/11-ipc.md`
- [x] 完成格式化、类型检查、前后端全量测试与编译检查

## 关键决策

- `WorkspaceStatus.head_ref` 由后端直接读取 HEAD：本地分支返回完整 ref，detached 返回 `HEAD`，unborn 返回符号目标；前端不再猜测该边界。
- 普通 Commit 的 `expected_head=null` 明确表示预期仍为 unborn，不表示跳过校验；三个提交命令都要求非空 expected ref。
- 直接提交只允许 `RepositoryState::Clean`；Merge / Rebase / Cherry-pick / Revert 必须使用各自 Continue 命令维护正确父链与清理状态。
- 不冻结 Index 内容；用户点击时提交后端实际 Index 快照，Watcher 的 staged 列表仍是交互提示而非锁。

## 验证方式

- Commit / Amend / HEAD Reword 发起后移动 HEAD 或切换分支，确认后端拒绝且新 HEAD 不被改写。
- 在 unborn、普通分支和 detached HEAD 分别提交，确认预期 ref 契约正确。
- 制造 Merge / Rebase 中间态，确认提交表单禁用且直接 IPC 同样拒绝。
- 切换仓库后让旧提交请求完成，确认只刷新原请求仓库且不清除新仓库草稿。
- 运行目标 Vitest / Rust 测试、`npx vue-tsc --noEmit`、`npm run test`、`cargo fmt`、`cargo check`、`cargo test`。
