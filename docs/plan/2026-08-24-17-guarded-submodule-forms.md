# 绑定 Submodule 表单仓库上下文

## Context

Add Submodule 在提交时读取当前活动仓库，Edit Submodule 通过 store 间接读取当前活动仓库。对话框打开后切仓会把输入应用到错误仓库；URL 编辑等待期间同名 Submodule 被外部改写时，后端也不会校验原 URL。

预期结果：两个表单绑定打开时的仓库并在切仓后保留输入、拒绝误写；编辑表单冻结原 Submodule 身份与 URL，IPC 在更新 `.gitmodules` 和同步本地 config 前校验预期旧 URL。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 现状审计 | 已完成 | Add / Edit 动态使用活动仓库且 URL 更新无后端校验 |
| 上下文保护 | 已完成 | 仓库 / 目标快照与 expected URL IPC |
| 测试与交付 | 已完成 | 表单漂移、后端竞态与全量门禁 |

## 子任务清单

- [x] 阅读 Submodule 表单、store、IPC 与引擎实现
- [x] Add Submodule 捕获打开时仓库 ID
- [x] Edit Submodule 捕获打开时仓库 ID 与原目标
- [x] 切仓后保留输入并显示上下文变化错误
- [x] store 的 URL 编辑使用显式仓库 ID
- [x] `set_submodule_url` IPC 接收 expected old URL
- [x] 后端修改前校验当前 Submodule URL
- [x] 增加 Add / Edit 表单切仓测试
- [x] 增加后端旧 URL 变化测试
- [x] 更新 Submodule、IPC 文档和中英文文案
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- 与 Remote 表单保持一致：上下文变化不清空输入，切回原仓库可继续，或取消后重新打开。
- Edit 冻结名称、路径和旧 URL；输入框只编辑新 URL，不跟随后续 props / store 刷新替换目标。
- expected URL 校验发生在写 `.gitmodules` 之前，失败时不调用 sync，也不产生父仓库改动。
- Add 不新增后端 expected 参数；新条目创建本身已有重名 / 路径校验，只需防止前端切仓误投。

## 验证方式

1. Add / Edit 在仓库 A 打开，切 B 后保存不调用 B 的 IPC，输入保留并显示错误。
2. 切回 A 后可继续提交原输入。
3. Edit 打开后目标 URL 被外部修改，后端拒绝旧 expected URL，请求不改 `.gitmodules`。
4. 目标精确匹配时 URL 更新并同步配置成功。
5. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
