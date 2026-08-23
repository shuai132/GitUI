# 首次 Push 发布分支并建立 Upstream

## Context

GitUI 当前可以把本地新分支 Push 到所选 remote，但成功后不会建立 upstream。用户看到的操作仍叫 Push，分支列表也无法立刻显示远程跟踪关系和 ahead / behind；后续命令行无参数 Pull / Push 仍会提示缺少 upstream。

GitHub Desktop 把未发布的新分支操作明确呈现为 “Publish branch”；Git 官方 `push --set-upstream` 会在成功推送后建立 tracking，供后续 Pull / Push 与同步状态使用。预期结果：无 upstream 的当前分支显示 Publish，成功推送后自动跟踪所选 remote 的同名分支；已有 upstream 的分支保持普通 Push 且绝不被改写。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 竞品与现状核对 | 已完成 | 对照 GitHub Desktop Publish 与 Git set-upstream 语义 |
| 后端发布语义 | 已完成 | 成功 Push 后为无 upstream 分支建立 tracking |
| 前端反馈 | 已完成 | 根据当前分支状态显示 Publish / Push 和对应成功提示 |
| 文档与验证 | 已完成 | 已同步分支 / 远程 / IPC 文档与 README，全量检查通过 |

## 子任务清单

- [x] 核对 Push、远端选择、分支刷新与 ahead / behind 数据流
- [x] 核对 GitHub Desktop Publish branch 与 Git `--set-upstream` 行为
- [x] 正常、force、force-with-lease 和 SSH Push 成功后统一补齐 upstream
- [x] 已有 upstream 时保留原配置，即使用户显式 Push 到其他 remote
- [x] Push 失败时不修改 tracking 配置
- [x] 无 upstream 的当前分支显示 Publish 文案，已有 upstream 保持 Push
- [x] remote 选择期间切换仓库 / 分支时丢弃旧 Push 请求
- [x] 覆盖首次发布、已有 upstream 保留与 UI 文案测试
- [x] 更新中英文文案、分支 / 远程 / IPC 文档和 README
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- 只有目标本地分支尚无 upstream 时才建立 tracking；现有 upstream 代表用户明确配置，即使对应 remote-tracking ref 已 gone 也不覆盖。列表从 branch 配置回退读取该状态，避免误显示 Publish。
- tracking 指向本次实际成功推送的 remote 同名分支，与 GitUI 固定使用同名 refspec 的现有 Push 契约一致。
- 仅在远端 Push 成功后修改本地配置；认证、网络、non-fast-forward 等失败不留下“已发布”的假状态。
- 首次发布语义适用于 normal、force、force-with-lease 及 SSH / HTTPS 两条驱动路径，避免同一按钮因协议产生不同结果。
- 默认 remote 偏好仍只保存在 UI，不主动改写 Git 配置；只有用户实际成功发布某条无 upstream 分支时，才按标准 Git 语义建立该分支 tracking。
- 前端用当前 `BranchInfo.upstream` 决定 Publish / Push，不增加新的 IPC 查询；成功后沿用现有分支全量刷新获取 tracking 和 ahead / behind。

## 验证方式

1. 新建无 upstream 分支，确认工具栏显示 Publish；推送到 origin 后显示 Push，并高亮 `origin/<branch>` 为 upstream。
2. 刷新分支列表，确认 ahead / behind 为可计算状态；命令行 `git rev-parse --abbrev-ref @{upstream}` 返回所选 remote 同名分支。
3. 已跟踪 origin 的分支显式 Push 到 backup，确认 upstream 仍为 origin，不被改写。
4. 制造认证、网络或 non-fast-forward 失败，确认分支仍无 upstream且 UI 仍显示 Publish。
5. remote 菜单打开时切换仓库 / 分支，确认旧 Push 请求不执行。
6. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
