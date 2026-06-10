# Watcher Rescan 刷新兜底

## Context

外部 agent 批量修改大量文件时，系统文件监听可能报告“事件不完整，需要重新扫描”。改动前 watcher 依赖 `notify-debouncer-mini`，这类无路径 rescan 事件可能不会进入前端刷新链路，导致工作区状态一直停留在旧快照，必须手动刷新才能看到变更。

预期结果：保留 300ms 防抖和 ignore 降噪，同时保证 watcher 一旦收到 rescan / 无路径兜底信号，就向前端发出保守的 `repo://status-changed`，由现有刷新链路重新读取真实状态。

## 进度总览

| 阶段 | 状态 | 内容 |
|------|------|------|
| 1 | 完成 | 梳理现有 watcher 与前端刷新链路 |
| 2 | 完成 | 替换 watcher 防抖层，保留 rescan 信号 |
| 3 | 完成 | 补测试与文档，跑验证 |

## 子任务清单

- [x] 阅读仓库管理、工作区和 IPC 文档。
- [x] 实现可保留 rescan 的 watcher 防抖批次。
- [x] 保证 ignore 过滤不会丢弃 rescan 兜底批次。
- [x] 增加 watcher / 分类测试。
- [x] 更新仓库管理文档。
- [x] 运行前后端测试与检查。

## 关键决策

- 做：把 rescan / 无路径事件归类为保守的 `.git` 变动，让前端执行完整必要刷新。
- 做：继续只监听激活仓库，继续对普通路径按 Git ignore 规则降噪。
- 不做：引入周期性全量轮询。轮询能兜底所有 watcher 漏报，但会给大仓库带来持续状态扫描成本。

## 验证方式

- `cd src-tauri && cargo test watcher`
- `npm run test`
- `npx vue-tsc --noEmit`
- `cd src-tauri && cargo check`
- `cd src-tauri && cargo test`
