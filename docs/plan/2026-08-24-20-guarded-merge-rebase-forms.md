# Guarded Merge/Rebase Forms

## Context

Merge 与 Rebase 对话框打开后仍从 store 读取提交时的 active repo；Rebase 计划异步返回时也不校验仓库和 HEAD。多仓库切换、外部引用更新或 HEAD 变化可能让旧来源 / 计划落到新上下文，历史改写边界尤其需要在后端写入前复核。目标是把两个对话框绑定到打开时的仓库、HEAD 与引用 OID，并让延迟响应和刷新都不能污染其他仓库。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 方案与契约 | 已完成 | 定义 Merge / Rebase 预期引用契约 |
| 后端保护 | 已完成 | 写入前校验 HEAD、source / upstream / onto |
| 前端流程 | 已完成 | 冻结对话框候选并丢弃过期计划响应 |
| 测试与文档 | 已完成 | 覆盖上下文漂移并同步设计 / IPC 文档 |
| 全量验证 | 已完成 | 前后端类型、测试和编译检查 |

## 子任务清单

- [x] Merge 保存 repoId、HEAD、目标分支与 source OID
- [x] Rebase Plan / Start 保存 repoId、HEAD、upstream / onto OID
- [x] 后端在任何 Merge / Rebase 写入前复核预期引用
- [x] 过期 Rebase Plan 响应不覆盖新仓库对话框
- [x] 操作完成后的刷新只作用于仍 active 的请求仓库
- [x] 增加对话框与 Rust 防护测试
- [x] 更新 `docs/15-merge-rebase.md` 与 `docs/11-ipc.md`
- [x] 完成格式化、类型检查、前后端全量测试与编译检查

## 关键决策

- 对话框冻结打开时已加载的分支候选与 OID；引用名称不变但 OID 变化时必须关闭并重新发起，不静默采用新目标。
- Rebase 计划请求携带预期 HEAD OID / ref、upstream 与 onto；响应返回后前端再次检查 repoId / 引用 / 请求序号，避免慢响应覆盖新对话框。
- `onto=null` 表示沿用 upstream 作为 rebase 目标，预期 onto OID 同样为 null；后端分别解析并比较明确提供的引用。
- 不对 todo 文案与排序做后端重算；后端通过预期 HEAD / 引用保证计划的提交范围仍对应打开时上下文。

## 验证方式

- 打开 Merge / Rebase 后切换仓库、移动 HEAD 或移动来源引用，确认旧请求在 IPC 前或 Rust 写入前被拒绝。
- 连续打开两个 Rebase 计划，延迟返回第一个响应，确认它不会覆盖第二个计划。
- 正常 Merge 与 Rebase 调用传递精确 repoId、HEAD 和引用 OID；完成后只刷新仍 active 的仓库。
- 运行目标 Vitest / Rust 测试、`npx vue-tsc --noEmit`、`npm run test`、`cargo fmt`、`cargo check`、`cargo test`。
