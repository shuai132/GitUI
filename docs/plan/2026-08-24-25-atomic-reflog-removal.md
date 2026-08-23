# Atomic Reflog Removal

## Context

“从 reflog 中移除”会先异步预览受影响入口数量，再由用户确认写回 HEAD reflog。当前确认阶段重新计算删除集合，却不验证它是否仍与预览一致；外部 Git 操作在两步之间新增或清理 reflog 时，实际范围可能不同于对话框展示。操作 store 还会在确认时重新读取 active repo。目标是把 dry-run 结果变成可复核的确认上下文，绑定 repoId、目标提交和精确入口集合。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 方案与契约 | 已完成 | 定义 Reflog 删除预览上下文 |
| 后端保护 | 已完成 | 写回前复核预览入口集合 |
| 前端流程 | 已完成 | 对话框绑定 repoId 与预览 token |
| 测试与文档 | 已完成 | 覆盖预览后 reflog 漂移 |
| 全量验证 | 已完成 | 前后端类型、测试和编译检查 |

## 子任务清单

- [x] 盘点预览、确认、store 与 IPC 数据流
- [x] 新增 `ReflogDropPreview` 返回数量与不透明上下文 token
- [x] `drop_unreachable_commit` 写回前复核 token
- [x] 对话框冻结 repoId、commit OID 与 token
- [x] 历史 store 只刷新仍活跃的请求仓库
- [x] 增加 Rust 和前端异步上下文回归测试
- [x] 更新 `docs/10-stash-reflog.md` 与 `docs/11-ipc.md`
- [x] 完成格式化、类型检查、前后端全量测试与编译检查

## 关键决策

- token 由本次将移除的 reflog entry 新 OID 序列生成，是后端解释的不透明确认上下文；前端只保存并原样回传。
- 与目标无关的 reflog 变化不阻断操作；只有实际删除集合改变才要求重新预览，减少不必要的失败。
- 后端先完成整组复核再调用 `reflog.remove`，不允许部分删除后才发现上下文漂移。
- 请求开始后切换仓库可让原仓库写入完成，但完成回调不刷新新仓库；确认前切换则拒绝旧对话框。

## 验证方式

- 预览目标链后新增该链的 reflog 后代，确认旧 token 被拒绝且 HEAD reflog 未改变。
- 重新预览后确认，实际删除数量与对话框展示一致。
- 预览或删除等待期间切换仓库，确认请求仍绑定原 repoId，且新仓库历史不被旧回调刷新。
- 运行目标 Vitest / Rust 测试、`npx vue-tsc --noEmit`、`npm run test`、`cargo fmt`、`cargo check`、`cargo test`。
