# 原始 Force Push 目标确认

## Context

GitUI 的 Push 下拉菜单同时提供 `--force-with-lease` 与原始 `--force`。菜单已优先排列安全强推，但用户点击原始 Force Push 后会立即执行，界面既不再次显示目标 remote / branch，也没有说明它会绕过 lease 并覆盖远端历史。

Git 官方文档明确指出 `--force` 会关闭非 fast-forward 与 lease 等安全检查，可能让远端提交丢失；`--force-with-lease` 则会在远端不是预期状态时拒绝。预期结果：原始 Force Push 在确定实际 remote 后显示危险确认，明确目标和后果；普通 Push 与 force-with-lease 保持现有一步执行。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 风险与现状核对 | 已完成 | 对照 Git force / force-with-lease 契约并确认当前无确认 |
| Push 流程重构 | 已完成 | 分离请求收集与实际执行，挂起原始 force 请求 |
| 确认交互 | 已完成 | 显示完整目标、风险、取消与危险确认按钮 |
| 文档与验证 | 已完成 | 已同步远程文档与 README，全量检查通过 |

## 子任务清单

- [x] 核对 Push 模式菜单、remote 选择和执行数据流
- [x] 核对 Git 官方 force / force-with-lease 风险差异
- [x] 抽取带 repo、remote、branch、mode 的不可变 Push 请求
- [x] 原始 force 在 remote 确定后挂起并显示完整目标
- [x] 取消或切换仓库 / 分支后不执行挂起请求
- [x] 确认按钮使用危险样式并在执行期间禁用关闭
- [x] normal 与 force-with-lease 保持直接执行
- [x] 覆盖弹窗目标、取消、确认和安全模式不弹窗测试
- [x] 更新中英文文案、远程文档和 README
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- 只拦截原始 `force`；`force_with_lease` 本身就是默认推荐的安全改写路径，不重复确认。
- 先完成 remote 选择再弹确认，因此文案展示实际将写入的 `<remote>/<branch>`，不是模糊的“当前分支”。
- 确认框不提供“以后不再提示”，避免一次偏好永久削弱高风险操作保护。
- 确认期间再次校验 active repo 与当前分支；上下文变化时直接取消，不猜测用户意图。
- 后端仍限定单分支完整 refspec，确认保护是 UI 风险分层，不改变 Push IPC 与 force 行为本身。

## 验证方式

1. 选择普通 Push 与 force-with-lease，确认 remote 选定后直接执行，不出现新弹窗。
2. 选择原始 Force Push，确认弹窗展示准确的 `remote/branch` 且未确认前不调用 IPC。
3. 点击取消或 Escape，确认不执行 Push；重新触发时仍要求确认。
4. 弹窗打开时切换仓库 / 分支后确认，确认旧请求被丢弃。
5. 点击危险确认，确认只执行一次原始 force，按钮加载期间不能重复提交或关闭。
6. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
