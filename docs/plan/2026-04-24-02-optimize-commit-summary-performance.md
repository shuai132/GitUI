# 2026-04-24-02-optimize-commit-summary-performance

## Context

用户反馈 `get_commit_summary` 接口在某些场景下耗时达 267ms，严重影响历史面板的响应速度。

原因分析：
1. 后端调用 `diff_tree_to_tree` 时使用了默认配置，导致 libgit2 执行了完整的补丁生成逻辑（读取 Blob 内容、生成上下文等），而摘要阶段仅需文件列表。
2. `get_commit_summary` 和 `get_commit_detail` 在处理 Stash 提交时存在类似的低效 Diff 调用。

## 进度总览

| 阶段 | 内容 | 状态 |
|------|------|------|
| P1 | 后端 DiffOptions 优化 | 已完成 |
| P2 | 验证 | 已完成 |

## 子任务清单

### P1 后端 DiffOptions 优化
- [x] 在 `get_commit_summary` 中引入优化后的 `DiffOptions`：设置 `context_lines(0)` 和 `interhunk_lines(0)`，大幅减少不必要的 Diff 内容计算。
- [x] 在 `get_commit_detail` 中同步应用上述优化，提升提交详情面板的初始加载速度。
- [x] 确保 Stash 提交的补全逻辑（对比 untracked tree）也使用了优化后的配置。

### P2 验证
- [x] `cargo check` 通过。
- [x] 逻辑覆盖：文件列表摘要请求现在将跳过详细的行内容对比。

## 关键决策

在摘要和详情加载阶段，将 `DiffOptions` 的上下文行数设为 0。对于摘要请求（`include_stats=false`），这能让 libgit2 仅停留在树节点对比层面，极大降低 I/O 和 CPU 消耗。
