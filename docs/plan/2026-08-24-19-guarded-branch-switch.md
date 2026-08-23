# Guarded Branch Switch

## Context

脏工作区分支切换确认框当前只保存目标分支名。确认期间若切换 active repo、HEAD / 目标分支变化，或工作区增加了未显示的路径，Stash、可恢复丢弃与 Checkout 可能处理确认框之外的上下文。工作区“丢弃全部”也只在前端检查 repoId，后端仍会枚举执行瞬间的全部改动。目标是让分支切换绑定仓库、HEAD、目标 OID 与路径快照，并让全部丢弃在任何移动 / Reset 前复核确认目标。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 方案与契约 | 已完成 | 定义分支切换和全部丢弃快照 |
| 后端保护 | 已完成 | 为 `discard_all_changes` 增加 HEAD / 路径校验 |
| 前端流程 | 已完成 | 显式绑定 repoId 并复核分支切换上下文 |
| 测试与文档 | 已完成 | 覆盖漂移拒绝并同步模块 / IPC 文档 |
| 全量验证 | 已完成 | 前后端类型、测试和编译检查 |

## 子任务清单

- [x] 保存分支切换请求的 repoId、HEAD、目标分支 OID 与路径集合
- [x] Stash、丢弃、Checkout 显式作用于请求所属仓库
- [x] `discard_all_changes` 在写入前校验预期 HEAD 与完整路径集合
- [x] 工作区“丢弃全部”传递确认时快照
- [x] 增加前端流程与 Rust 防护测试
- [x] 更新 `docs/03-workspace.md`、`docs/07-branches.md` 与 `docs/11-ipc.md`
- [x] 完成格式化、类型检查、前后端全量测试与编译检查

## 关键决策

- 路径集合按去重后的相对路径比较，不因同一文件同时 staged / unstaged 而产生重复；确认后新增或移除任何路径都拒绝旧请求。
- HEAD 同时校验 commit OID 与前端分支上下文；目标本地分支在执行前复核 OID，避免旧确认切到已经被外部移动的引用。
- Stash 本身可恢复，不新增后端内容哈希；执行前仍复核仓库、HEAD 与路径集合。全部丢弃是破坏性边界，因此在 Rust 内再次校验后才移动文件。
- Stash / 丢弃成功而 Checkout 失败后的重试只校验仓库、HEAD 与目标分支，不要求原路径仍存在，也不重复执行已经完成的保护步骤。

## 验证方式

- 打开脏工作区切换框后切仓库、移动 HEAD / 目标分支或新增改动路径，确认 Stash、丢弃和 Checkout 都不会执行旧请求。
- 正常选择三种模式均作用于捕获的 repoId；Stash / 丢弃后 Checkout 失败仍可只重试 Checkout。
- 打开“丢弃全部”后新增路径，确认后端在任何文件进入废纸篓前拒绝，原内容全部保留。
- 运行目标 Vitest / Rust 测试、`npx vue-tsc --noEmit`、`npm run test`、`cargo fmt`、`cargo check`、`cargo test`。
