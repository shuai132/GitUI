# 精确保护 Remote 删除

## Context

Git 官方说明 `git remote remove` 会同时删除该 Remote 的全部配置和 remote-tracking branches。当前确认框只显示 Remote 名称，不展示 URL 或本地 tracking refs 数量；确认期间 Remote 被编辑、替换或活动仓库变化时，后端仍按名称直接删除。

预期结果：确认框展示名称、完整 URL 与将被清理的 remote-tracking branches 数量；确认绑定仓库、Remote URL 与 refs 快照，变化时取消。IPC 把预期 URL 传给后端并在删除配置前再次校验，避免前端检查与执行之间的竞态。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 现状审计 | 已完成 | 确认名称不足且后端无目标校验 |
| 精确保护 | 已完成 | UI 快照与后端 expected URL 校验 |
| 测试与交付 | 已完成 | 竞态测试、文档与全量门禁 |

## 子任务清单

- [x] 对照 Git 官方 Remote 删除影响范围
- [x] 阅读 Remote 设计、IPC、组件与引擎实现
- [x] 确认框展示 Remote 名称、URL 与 tracking refs 数量
- [x] 确认绑定仓库、Remote URL 与 tracking refs 快照
- [x] 上下文变化时取消旧删除请求
- [x] `remove_remote` IPC 接收 expected URL
- [x] 后端删除前校验当前 Remote URL
- [x] 增加前端目标漂移与后端 URL 变化测试
- [x] 更新 Remote、IPC 文档和中英文文案
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- 删除仍只影响本地 Remote 配置与 remote-tracking refs，不暗示会删除服务器仓库或远端分支。
- URL 使用 `list_remotes` 返回的实际 fetch URL 做强一致校验；URL 缺失也作为明确的 `null` 快照处理。
- 前端 refs 快照用于保证确认文案的影响数量仍准确；后端 URL 校验作为不可绕过的最终目标保护。
- 不为本地 tracking refs 增加恢复流程；确认文案明确影响，远端仍存在时可重新添加 Remote 并 Fetch 恢复。

## 验证方式

1. 删除确认展示完整 URL 和当前 remote-tracking branches 数量。
2. 确认期间切换仓库、修改 Remote URL 或 refs 快照后，旧请求被取消。
3. 绕过前端直接调用但 expected URL 已过期时，后端保留 Remote 与 refs。
4. expected URL 精确匹配时正常删除配置与 tracking refs，并刷新列表。
5. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
