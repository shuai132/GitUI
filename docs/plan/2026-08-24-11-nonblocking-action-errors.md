# 统一非阻塞操作错误提示

## Context

`useGitCommands` 已把 IPC 失败写入 `errorsStore`，并由 `ToolbarToast` 展示和保留错误历史；历史、工作区、仓库恢复与 Submodule 等调用方仍在 catch 后执行原生 `alert`，造成同一失败先 Toast、再阻塞整个 Tauri 窗口。另一方面，剪贴板、目录选择等前端边界错误不会经过 IPC，不能简单吞掉所有 catch。

预期结果：IPC 错误带有可识别类型，调用方知道它已经进入统一错误通道；仅对未被统一通道处理的前端异常补充全局 Toast。移除业务组件中的原生 `alert`，既避免重复提示，也不丢失非 IPC 错误。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 现状审计 | 已完成 | 定位 18 处原生 alert 与重复提示来源 |
| 错误边界 | 已完成 | 区分已记录 IPC 错误与本地 UI 异常 |
| 调用方迁移 | 已完成 | 历史、工作区、仓库与 Submodule 改用非阻塞提示 |
| 测试与交付 | 已完成 | 去重、fallback、完整门禁与 staged diff 已核对 |

## 子任务清单

- [x] 核对 `useGitCommands`、`errorsStore` 与 `ToolbarToast` 数据流
- [x] 定义可识别的 IPC command 错误类型
- [x] 为 `useGlobalToast` 增加仅补报未处理异常的入口
- [x] 迁移历史详情与提交菜单失败路径
- [x] 迁移工作区文件与 Submodule 失败路径
- [x] 迁移不可用仓库恢复 / 定位 / 移除失败路径
- [x] 移除业务代码中的全部原生 `alert`
- [x] 覆盖 IPC 错误去重与非 IPC fallback 测试
- [x] 更新架构错误处理文档
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- `useGitCommands.call` 写入 `errorsStore` 后抛出专用 Error 子类；消息继续使用映射后的友好文本，不改变现有调用方的 `Error` 语义。
- 全局 Toast 提供 `showActionError(error, fallbackMessage?)`：专用 IPC 错误不再二次展示；其他异常使用调用方上下文化文案或 `String(error)`。
- 操作失败的持久化历史仍只记录 IPC 错误；剪贴板等本地异常仅作短时 Toast，不伪装成后端 Git 错误。
- 本轮不改 IPC 命令、业务成功路径或错误映射规则。

## 验证方式

1. 模拟 IPC 调用失败，确认只出现 `ToolbarToast`，不会再触发调用方 Toast 或阻塞弹窗。
2. 模拟剪贴板、目录选择等非 IPC 异常，确认出现一次上下文化全局 Toast。
3. 搜索业务代码确认不存在 `alert(`。
4. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
