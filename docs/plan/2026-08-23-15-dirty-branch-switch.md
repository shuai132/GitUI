# 脏工作区分支切换引导

## Context

GitUI 当前双击或菜单切换本地分支时直接执行 safe checkout：若目标分支不触碰本地修改，改动会被静默带到新分支；若冲突则只显示通用错误。用户在操作前既不知道改动会跟随，也没有就地保存并继续切换的入口。

GitHub Desktop 官方发布说明明确把脏工作区分支切换拆成“stash 在当前分支”与“把改动带到新分支”两个选择；GitKraken 官方文档也建议在切错分支时 stash、切换再 pop。预期结果：GitUI 在检测到 staged / unstaged / untracked 改动时先显示选择框，让用户明确选择携带改动或先 stash；clean 工作区仍保持直接切换。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 竞品与现状核对 | 已完成 | 确认 GitHub Desktop 双选择与 GitUI 静默行为差距 |
| 切换流程 | 已完成 | 抽取可复用的脏工作区切换协调逻辑 |
| UI 接入 | 已完成 | 侧边栏与分支页接入同一选择框 |
| 文档与验证 | 已完成 | 同步分支文档、README 并完成全量检查 |

## 子任务清单

- [x] 核对现有分支切换、stash 与工作区刷新数据流
- [x] 核对 GitHub Desktop / GitKraken 的对应交互
- [x] 实现可复用的分支切换流程与错误恢复状态
- [x] 新增“携带改动 / Stash 后切换”对话框
- [x] 接入侧边栏双击、右键普通切换与分支管理页
- [x] clean 工作区保持一步切换，成功后立即刷新工作区
- [x] 覆盖 clean、carry、stash 与切换失败场景测试
- [x] 更新中英文文案、分支文档和 README
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- 只在工作区存在 staged、unstaged 或 untracked 项时打断流程；clean 工作区不增加点击成本。
- “携带改动”沿用 libgit2 safe checkout，不使用 force；目标分支冲突时保持对话框打开，并提示可改选 stash。
- “Stash 后切换”复用现有包含 untracked 的 stash 命令，生成带来源 / 目标分支的可识别消息；切换后 stash 保留在侧边栏，由用户决定何时 apply / pop。
- stash 成功但切换失败时不自动 pop，避免二次冲突；对话框明确告知改动已经安全保存在 stash。
- 强制切换仍保留为独立危险菜单，不混入普通切换选择框。
- 创建新分支并立即切换仍直接携带当前改动，这是用户把误写在旧分支的工作迁入新分支的常见意图。

## 验证方式

1. clean 工作区双击分支，确认不弹窗、切换后工作区立即刷新。
2. 脏工作区双击或右键普通切换，确认弹窗显示改动数量和来源 / 目标分支。
3. 选择携带改动，确认 safe checkout 成功时改动留在工作区；冲突时仍在原分支且可改选 stash。
4. 选择 Stash 后切换，确认 staged / unstaged / untracked 被保存、目标分支 clean、stash 侧边栏出现可识别消息。
5. 模拟 stash 成功后切换失败，确认 stash 保留且错误文案不会声称改动丢失。
6. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
