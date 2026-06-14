# 新建 Worktree

## Context

“所有仓库”列表目前只支持打开、克隆、初始化、切换和基础右键操作。用户在多个分支并行开发时，需要从已打开仓库快速创建 linked worktree，并把新 worktree 作为独立仓库加入列表、立即切换过去。

预期结果：

- 在“所有仓库”列表的仓库行右键菜单中提供“新建 Worktree”入口。
- 用户选择目标目录、起点分支，并输入新分支名后创建 linked worktree。
- 创建成功后复用现有 `openRepo` 流程注册、持久化并激活新 worktree。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 方案 | 已完成 | 明确交互、IPC 和验证范围 |
| 后端 | 已完成 | 新增 `create_worktree` 命令与 GitEngine 实现 |
| 前端 | 已完成 | 所有仓库行右键入口和创建对话框 |
| 文档 | 已完成 | 同步 README、仓库管理和 IPC 文档 |
| 验证 | 已完成 | 格式化、类型检查、单元测试、Rust 编译测试 |

## 子任务清单

- [x] 新增 `create_worktree` IPC，并在 `lib.rs::generate_handler!` 注册。
- [x] 后端校验目标目录、新分支名和起点分支，并用 libgit2 创建 worktree。
- [x] 为 worktree 创建添加 Rust 单元测试。
- [x] 前端封装 `git.createWorktree()` 与 `repoStore.createWorktree()`。
- [x] 新增 `CreateWorktreeDialog`，从“所有仓库”行右键菜单打开。
- [x] 创建成功后将新 worktree 加入仓库列表并激活。
- [x] 同步中英文文案、README、`docs/02-repo-management.md` 和 `docs/11-ipc.md`。
- [x] 运行格式化、前端类型检查/测试、Rust check/test。

## 关键决策

- 只新增创建能力，不做 worktree 删除、lock、prune 或列表管理；这些会改变仓库生命周期语义，留给后续独立设计。
- 后端不直接注册仓库名册，只返回 worktree 路径；前端继续走现有 `openRepo`，保持 clone/init/worktree 的创建后收敛路径一致。
- 首版以“新分支 + 起点分支”创建 worktree，避免把已检出的本地分支重复检出到另一个 worktree 的失败场景变成主流程。
- 起点分支可选本地或远程分支；远程分支作为 commit 起点创建本地新分支，不自动设置 upstream，避免隐式改写远程跟踪配置。

## 验证方式

- 单元测试覆盖从 HEAD、本地分支和远程分支起点创建 worktree 的核心路径。
- `cd src-tauri && cargo fmt`
- 前端如配置格式化脚本则运行对应格式化命令。
- `npx vue-tsc --noEmit`
- `npm run test`
- `cd src-tauri && cargo check`
- `cd src-tauri && cargo test`
