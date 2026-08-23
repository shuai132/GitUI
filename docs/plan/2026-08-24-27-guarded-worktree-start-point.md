# Guarded Worktree Start Point

## Context

创建 Worktree 对话框从分支列表选择起点，但提交时只传分支名；若外部 Fetch、Reset 或另一个窗口在列表加载后移动该引用，新分支会悄悄从用户未确认的 commit 创建。`git worktree add -b` 的核心语义是从明确的 commit-ish 创建新分支。目标是在选项中展示短 SHA，并把完整 OID 作为确认上下文交给后端复核。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 方案与契约 | 已完成 | 定义 Worktree 起点 OID 契约 |
| 后端保护 | 已完成 | 创建分支前复核起点引用 |
| 前端流程 | 已完成 | 展示并回传所选短 SHA / OID |
| 测试与文档 | 已完成 | 覆盖引用漂移与表单参数 |
| 全量验证 | 已完成 | 前后端类型、测试和编译检查 |

## 子任务清单

- [x] 盘点 Worktree 对话框、store、IPC 与 Git 引擎调用链
- [x] `create_worktree` 必须接收预期起点 OID
- [x] 后端在创建任何分支或目录前复核分支名称与 OID
- [x] 起点下拉展示短 SHA 并回传完整 OID
- [x] 增加 Rust 与组件回归测试
- [x] 更新 `docs/07-branches.md` 与 `docs/11-ipc.md`
- [x] 完成格式化、类型检查、前后端全量测试与编译检查

## 关键决策

- 分支名保留为用户选择和 ref 类型解析依据，OID 是不可变的确认身份；二者必须同时匹配。
- 起点为 HEAD 时也要求预期 OID，避免省略 start point 的内部调用绕过保护。
- 复核发生在创建本地分支与目标目录前，失败不留下 branch、worktree metadata 或文件。
- 不自动改用旧 OID 创建：引用移动可能意味着用户应重新理解最新分支状态，安全行为是刷新并重选。

## 验证方式

- 打开对话框后移动所选本地或远程分支，确认创建被拒绝且未产生分支 / 目录。
- 正常选择本地、远程和当前分支起点，确认短 SHA 展示与最终 Worktree HEAD 一致。
- 检查创建成功后仍自动加入所有仓库并激活。
- 运行目标 Vitest / Rust 测试、`npx vue-tsc --noEmit`、`npm run test`、`cargo fmt`、`cargo check`、`cargo test`。
