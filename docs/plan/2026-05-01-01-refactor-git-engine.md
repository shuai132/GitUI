# Context

`src-tauri/src/git/engine.rs` 已超过 4000 行，承担工作区、历史、diff、分支、远程、子模块、stash/reflog 等多个领域的实现。继续在单文件内维护会增加修改冲突和回归风险。

本次重构目标是先做低风险拆分：保持 `GitEngine` 对外静态方法集合不变，把工作区状态、索引操作、提交创建和仓库状态读取移动到 `git/engine/workspace.rs`。预期结果是 `engine.rs` 只保留公共入口类型、共享辅助函数和其他尚未拆分的领域实现，IPC 契约与用户可见行为不变。

# 进度总览

| 阶段 | 状态 | 说明 |
|------|------|------|
| 方案 | 完成 | 明确先拆工作区领域，不改契约 |
| 实现 | 完成 | 新增 `engine/workspace.rs` 并迁移相关 impl |
| 验证 | 完成 | Rust/前端检查与测试通过 |

# 子任务清单

- [x] 阅读架构、历史、diff、IPC 文档，确认本次不触碰用户可见契约。
- [x] 新增 `src-tauri/src/git/engine/workspace.rs`。
- [x] 迁移 `get_status`、stage/unstage、commit 创建和 repo state 相关实现。
- [x] 清理 `engine.rs` imports 和模块声明。
- [x] 运行 `cd src-tauri && cargo fmt`。
- [x] 运行 `cd src-tauri && cargo check`。
- [x] 运行相关后端测试。
- [x] 运行完整前端类型检查与单元测试。
- [x] 运行完整后端单元测试。

# 关键决策

- **保持 `crate::git::engine::GitEngine` 路径不变**：commands 层和现有调用方无需改动。
- **使用 `engine.rs` 子模块拆分，而不是改成新的顶层 facade**：降低一次性移动范围，后续可以按 diff、branch、remote 等领域继续拆。
- **不改 IPC 数据结构和行为**：本次只调整 Rust 内部组织，因此不更新 `docs/11-ipc.md` 和 README 功能清单。
- **不顺手重写算法**：`get_status` 的 diff stats、repo state 文件读取等逻辑保持原语义，避免把结构重构和行为变更混在一起。

# 验证方式

- `cd src-tauri && cargo fmt`
- `cd src-tauri && cargo check`
- `npx vue-tsc --noEmit`
- `npm run test`
- `cd src-tauri && cargo test`
- `cd src-tauri && cargo test git::engine::tests::test_get_status`
- `cd src-tauri && cargo test git::engine::tests::test_get_log`
