# 绑定 Remote 表单仓库上下文

## Context

添加和编辑 Remote 的对话框在提交时才读取 `activeRepoId`。用户打开表单、填写 URL 后切换仓库，输入会被应用到新仓库；编辑同名 Remote 时，目标 URL 在等待期间被外部修改，后端仍按名称执行 rename / set-url。

预期结果：两个表单绑定打开时的仓库，活动仓库变化后保留输入但拒绝提交并给出明确提示；编辑表单同时冻结原名称与 URL，IPC 在写配置前校验预期旧 URL。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 现状审计 | 已完成 | 表单提交时动态读取活动仓库且编辑无后端校验 |
| 上下文保护 | 已完成 | 打开时仓库快照与 expected URL IPC |
| 测试与交付 | 已完成 | 表单漂移、后端竞态与全量门禁 |

## 子任务清单

- [x] 阅读 Remote 表单、父组件、IPC 与引擎实现
- [x] Add Remote 捕获打开时仓库 ID
- [x] Edit Remote 捕获打开时仓库 ID 与原目标
- [x] 切仓后保留输入并显示上下文变化错误
- [x] `edit_remote` IPC 接收 expected old URL
- [x] 后端写入前校验当前名称与 URL
- [x] 增加 Add / Edit 表单切仓测试
- [x] 增加后端旧 URL 变化测试
- [x] 更新 Remote、IPC 文档和中英文文案
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- 表单上下文变化时不自动清空或关闭，避免用户丢失已输入的名称 / URL；用户回到原仓库可继续提交，或取消后重新打开。
- Add 只需绑定仓库 ID；Edit 还必须冻结原目标名称与 URL，并由后端强制校验 URL。
- 新名称和新 URL 仍允许用户在表单内自由编辑，不因为内容变化触发上下文取消。
- 不把 Remote 表单改成全局模态路由；保持现有侧边栏入口和成功刷新流程。

## 验证方式

1. Add / Edit 对话框在仓库 A 打开，切到 B 后点击保存，不调用 B 的 IPC，输入仍在且显示错误。
2. 切回 A 后可以继续提交原输入。
3. Edit 打开后同名 Remote URL 被外部改动，后端拒绝旧 expected URL 请求且配置保持不变。
4. 目标精确匹配时重命名 / 修改 URL 正常完成。
5. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
