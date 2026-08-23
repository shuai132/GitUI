# 保护本地与远端分支删除

## Context

GitUI 删除本地分支时只捕获分支名；若确认期间同名分支被外部命令推进或重建，旧确认会删除新目标。存在 upstream 时，组合删除当前先删本地再删远端，远端失败会留下半完成结果；upstream 已 gone 时仍展示“一并删除”选项，也会给出无法兑现的操作预期。

Git 官方的显式 `--force-with-lease=<ref>:<expect>` 只在远端引用仍等于指定 OID 时允许更新，并在不匹配时拒绝 push。预期结果：本地删除校验捕获的 commit OID；远端删除用显式 lease 原子保护用户看到的 upstream；组合删除按远端后本地执行，远端变化或失败时保留本地分支。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 现状与 Git 语义 | 已完成 | 确认半完成顺序与显式 force-with-lease 能力 |
| IPC 与后端 | 已完成 | 为本地 / 远端分支删除增加预期 OID |
| UI 流程 | 已完成 | upstream 捕获、gone 处理和远端后本地排序 |
| 测试与交付 | 已完成 | lease、UI 流程与全量门禁通过，staged diff 已核对 |

## 子任务清单

- [x] 核对 `BranchInfo.commit_oid`、upstream 与远端分支列表
- [x] 核对显式 `--force-with-lease=<ref>:<expect>` 删除语义
- [x] `delete_branch` 在删除前校验本地分支 commit OID
- [x] `delete_remote_branch` 使用 expected OID 的显式 lease
- [x] 删除确认展示本地分支短 OID 与完整 upstream
- [x] upstream 已 gone 时只提供本地删除，不显示组合选项
- [x] 组合删除按远端后本地执行，任一上下文变化时停止
- [x] 错误反馈改为非阻塞全局提示
- [x] 覆盖本地目标变化、远端 lease 和组合删除顺序测试
- [x] 更新分支与 IPC 文档、中英文文案
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- 本地删除捕获 `repoId`、分支名与 `BranchInfo.commit_oid`；确认时前端先校验当前列表，后端再读取实际引用复核。
- 仅当 `BranchInfo.upstream` 能在已加载远端分支列表中找到精确 `commit_oid` 时显示“一并删除”；配置存在但远端引用已 gone 时，确认文案说明只删除本地 tracking 配置所在分支。
- 远端删除通过系统 Git 的显式 `--force-with-lease=refs/heads/<branch>:<expected>` 与删除 refspec 在同一次 push 中执行；不使用会受后台 fetch 影响的隐式 lease。
- 组合删除先删除远端，再重新校验仓库与本地分支，最后删除本地；远端被推进或服务端拒绝时本地不动。
- 远端成功、本地随后变化的极短窗口中，后端拒绝删除新本地分支；用户可重新选择本地目标。
- 不改变 libgit2 对未合并本地分支的既有删除规则。

## 验证方式

1. 删除本地非当前分支，确认框显示名称与短 OID，命令携带完整 expected OID。
2. 确认期间推进 / 重建同名本地分支，确认后端拒绝删除。
3. upstream 存在且已加载时勾选组合删除，确认远端先于本地执行。
4. 远端分支在确认后推进，确认显式 lease 拒绝删除且本地保留。
5. upstream 已 gone 时确认不显示组合删除选项。
6. 确认后切换仓库，确认旧请求不作用于新仓库。
7. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
