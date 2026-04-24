# 2026-04-24-01-fix-history-select-crash

## Context

用户反馈在选中特定历史提交时，前端抛出 `TypeError: undefined is not an object (evaluating 's.replace')` 崩溃。

经过分析，原因是：
1. `src/lib/highlight.ts` 中的 `escapeHtml` 函数未检查输入是否为字符串。
2. `src/lib/wordDiff.ts` 中的 `escHtml` 函数未检查输入是否为字符串。
3. `InlineDiff.vue` 和 `SideBySideDiff.vue` 在处理 `line.content` 或 `hunk.header` 时，若后端返回了 `null`/`undefined`（虽然 Rust 类型定义为 `String`，但在 JSON 反序列化或前端处理逻辑中可能出现意外），会直接调用 `replace()` 或 `trimEnd()` 导致崩溃。

## 进度总览

| 阶段 | 内容 | 状态 |
|------|------|------|
| P1 | 基础工具函数加固 | 已完成 |
| P2 | Diff 组件防御性代码 | 已完成 |
| P3 | 验证 | 已完成 |

## 子任务清单

### P1 基础工具函数加固
- [x] `src/lib/highlight.ts`：`escapeHtml` 增加 `typeof s !== 'string'` 检查。
- [x] `src/lib/wordDiff.ts`：`escHtml` 增加 `typeof s !== 'string'` 检查。

### P2 Diff 组件防御性代码
- [x] `src/components/diff/InlineDiff.vue`：处理 `line.content` 和 `hunk.header` 时增加 `?? ''` 兜底。
- [x] `src/components/diff/SideBySideDiff.vue`：处理 `line.content` 和 `hunk.header` 时增加安全检查。

### P3 验证
- [x] `npm run build` 通过（无 TS 语法错误）。
- [x] 逻辑覆盖：即使 `content` 缺失，应用也不会崩溃。

## 关键决策

采取"多层防御"策略：
1. 在最底层的字符串处理工具（`escapeHtml`）中加固，防止任何意外流入的非字符串导致崩溃。
2. 在中间层的计算属性（`rows`, `alignedRows`）中加固，确保传递给下游组件的数据始终符合预期（即使后端数据异常）。
