# Push / Pull 默认远端

## Context

当前 Push / Pull 在仓库配置多个 remote 时每次都会弹出远端选择菜单。用户希望在这个菜单的 remote 名字后面直接设置或取消默认远端，减少重复选择。

预期结果：用户可以为每个仓库保存一个 UI 层默认 remote；默认 remote 仍存在时，Push / Pull 主流程优先使用它；远端选择菜单中可对任意 remote 设置默认或取消默认。

## 进度总览

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 1 | 完成 | 记录方案与现有同步菜单行为 |
| 2 | 完成 | 增加仓库级默认 remote 偏好 |
| 3 | 完成 | 调整远端选择菜单 UI 与文案 |
| 4 | 完成 | 更新文档并验证 |

## 子任务清单

- [x] 阅读 `docs/08-remote.md` 与 toolbar 远端选择实现。
- [x] 在 UI store 中保存仓库路径维度的默认 remote。
- [x] 远端选择菜单支持 remote 行尾操作：设为默认 / 取消默认。
- [x] Push / Pull 在默认 remote 有效时跳过重复选择。
- [x] 更新 `docs/08-remote.md`。
- [x] 增加并运行针对默认 remote 偏好的单元测试。

## 关键决策

- **做 UI 层偏好，不写 Git 配置**：默认 remote 只服务 GitUI 的 Push / Pull 交互，不修改 `branch.<name>.remote` 或 upstream，避免影响用户在命令行里的 Git 行为。
- **按仓库路径保存**：后端 `repo_id` 是运行时标识，应用重启后可能变化；路径更适合持久化偏好。
- **失效自动回退**：如果默认 remote 被删除或重命名，下一次 Push / Pull 会回到远端选择菜单，并清理无效默认值。
- **不改变 Fetch All**：Fetch 仍可选择单个 remote 或 `Fetch All`，本次只解决 Push / Pull 重复选择。

## 验证方式

1. `npx vue-tsc --noEmit`
2. `npm run test -- src/stores/ui.spec.ts`
3. 手动验证多 remote 仓库：首次 Push / Pull 弹菜单，点击行尾“设为默认”后再次触发应直接使用默认 remote；删除或重命名该 remote 后应重新弹菜单。
