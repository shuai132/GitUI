# Pull 自动暂存与恢复

## Context

GitUI 当前从工具栏执行 Pull 时，工作区有改动会在 rebase / merge 路径中直接报错，用户只能手动完成 stash → pull → pop；fast-forward 路径则缺少同样的统一保护，强制 checkout 存在覆盖本地改动的风险。

Git 官方 `git pull --autostash` 会在操作前创建临时 stash、操作结束后恢复，并明确提醒恢复阶段可能产生冲突。预期结果：clean 工作区仍然一步 Pull；脏工作区明确询问后自动暂存并恢复；Pull 留下合并中间态或无法确认仓库状态时不自动 pop，保证原始改动仍保留在 stash。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 竞品与现状核对 | 已完成 | 对照 Git 官方 autostash 语义并确认现有 fast-forward 风险 |
| 后端安全线 | 已完成 | 所有 Pull 模式在 fetch 前统一拒绝脏工作区和未完成操作 |
| 前端流程 | 已完成 | 脏工作区确认后自动 stash、Pull、按仓库状态恢复 |
| 文档与验证 | 已完成 | 已同步远程 / stash / IPC 文档和 README，全量检查通过 |

## 子任务清单

- [x] 核对 Pull、stash、工作区状态刷新与错误提示流程
- [x] 核对 Git 官方 `pull --autostash` / `rebase --autostash` 行为
- [x] 后端在 fetch 和任何引用更新前统一检查 staged / unstaged / untracked
- [x] clean 工作区保持直接 Pull，不增加弹窗或额外 IPC
- [x] 脏工作区显示改动数量和自动 stash / 恢复说明
- [x] Pull 成功或失败后仅在仓库 clean 时恢复临时 stash
- [x] 合并中间态、状态读取失败或 stash pop 冲突时保留 stash 并明确提示
- [x] 覆盖成功、Pull 失败、合并冲突、恢复失败等流程测试
- [x] 更新中英文文案、远程 / stash / IPC 文档和 README
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- 后端 Pull 命令只接受没有未完成 Git 操作的 clean 工作区，并在网络 fetch 前检查，避免前端状态过期或其他 IPC 调用绕过安全线。
- 安全检查包含 untracked 文件，因为 fast-forward checkout 也可能与同路径远端文件冲突；ignored 文件不参与。
- 前端先确定 remote，再询问是否自动 stash，避免用户取消 remote 选择后留下无意义的 stash。
- 自动 stash 包含 untracked，消息标明 Pull 的远端与分支，意外中断后仍可从现有 Stash 列表识别和恢复。
- Pull 后读取真实仓库状态；只有 `clean` 才 pop。存在 merge / rebase 等中间态或状态未知时保留 stash，避免把原始改动叠加到未解决冲突上。
- stash pop 冲突不隐藏 Pull 结果，也不删除 stash；刷新工作区和 Stash 列表后引导用户手动处理。

## 验证方式

1. clean 工作区以 fast-forward / ff-only / rebase Pull，确认无弹窗且结果立即刷新。
2. staged、unstaged、untracked 各类改动存在时 Pull，确认显示数量并可取消，不产生 stash。
3. 确认自动处理后，验证原始改动被 stash、Pull 完成、改动恢复且临时 stash 消失。
4. 模拟网络失败或 ff-only 分叉，确认仓库 clean 时原始改动仍自动恢复。
5. 制造 Pull merge 冲突，确认不自动 pop，原始改动仍在 Stash 列表且提示需要先处理冲突。
6. 制造 stash pop 冲突，确认工作区显示冲突、stash 条目仍可见且有明确提示。
7. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
