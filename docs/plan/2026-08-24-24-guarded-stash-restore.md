# Guarded Stash Restore

## Context

Git 以 `refs/stash` 的 reflog 顺序解释 `stash@{n}`；外部新增或删除条目后，同一 index 会指向不同 stash。GitUI 的 Pop / Drop 已可携带 commit OID 复核目标，但 Apply 仍只传 index，且三个动作完成后可能刷新用户后来切换到的仓库。目标是让所有 Stash 恢复与删除入口绑定打开动作时的 repoId、index 和 commit OID，并只刷新仍然活跃的请求仓库。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 方案与契约 | 已完成 | 明确 stash 条目身份和仓库边界 |
| 后端保护 | 已完成 | Apply 写入前复核 index 对应 OID |
| 前端流程 | 已完成 | 所有入口显式传递 repoId 与 OID |
| 测试与文档 | 已完成 | 覆盖栈重排和跨仓库完成回调 |
| 全量验证 | 已完成 | 前后端类型、测试和编译检查 |

## 子任务清单

- [x] 盘点侧边栏、历史图和工具栏 Stash 动作入口
- [x] `stash_apply` IPC 必须携带预期 commit OID
- [x] Stash store 的 Apply / Pop / Drop 显式接收 repoId
- [x] 操作完成后仅刷新仍活跃的请求仓库
- [x] 侧边栏和历史图传递所选条目的 repoId、index 与 OID
- [x] 增加 Rust 与 store / 组件回归测试
- [x] 更新 `docs/10-stash-reflog.md` 与 `docs/11-ipc.md`
- [x] 完成格式化、类型检查、前后端全量测试与编译检查

## 关键决策

- index 只用于调用 libgit2，commit OID 才是用户选择的条目身份；Apply 在任何工作区写入前先复核二者对应关系。
- store 不在 `await` 后重新读取 active repo 来推断请求归属；调用方必须传入捕获的 repoId。
- 用户在请求期间切换仓库时，原仓库动作允许完成，但跳过当前窗口的 Stash / Workspace / History 刷新，避免污染新仓库视图。
- 保留 Apply 与 Pop 的现有交互差异：Apply 保留条目，Pop 成功后删除条目；本轮不改变 Git 的冲突处理语义。

## 验证方式

- 在读取列表后从外部 push / drop stash，确认旧 Apply 请求在改动工作区前被拒绝。
- 从侧边栏和历史图 Apply 同一条目，确认 IPC 收到所选 OID 而非只收到 index。
- Apply / Pop / Drop 等待期间切换仓库，确认操作仍落到原 repoId 且不刷新新仓库。
- 运行目标 Vitest / Rust 测试、`npx vue-tsc --noEmit`、`npm run test`、`cargo fmt`、`cargo check`、`cargo test`。
