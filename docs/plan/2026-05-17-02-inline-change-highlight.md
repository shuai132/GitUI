# Diff 行内字符级变化高亮

## Context

当前文本 diff 已有行级新增 / 删除背景，也已有 `wordDiff.ts` 的字符级差异能力。但在启用语法高亮时，`InlineDiff` / `SideBySideDiff` 会优先渲染 `highlightLine()`，导致配对的删除 / 新增行不能显示具体变化位置；单列按 hunk 分组模板也没有消费已有的行内 diff HTML。

本次目标是在不改后端 diff 契约的前提下，让所有文本 diff 模式都能同时显示语法高亮和字符级变化标注。

## 进度总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 新增语法高亮 + 字符级 mark 合成工具 | 完成 |
| 2 | 接入左右分栏和单列 diff 组件 | 完成 |
| 3 | 补齐单列按 hunk 分组显示 | 完成 |
| 4 | 文档和 README 同步 | 完成 |
| 5 | 类型检查、测试和手动验证 | 自动验证完成，手动待验证 |

## 子任务清单

- [x] 新增 `src/lib/diffLineHtml.ts`，把 `highlightLine()` 输出与 `wordDiff.ts` token 合成为安全 HTML。
- [x] 更新 `SideBySideDiff`，配对 del/add 行在语法高亮开启时也显示 `word-del` / `word-add`。
- [x] 更新 `InlineDiff`，连续模式和按 hunk 分组模式都渲染行内字符级变化。
- [x] 添加单元测试和组件测试覆盖语法高亮叠加、HTML 转义、左右分栏、单列连续、单列 hunk 分组。
- [x] 同步 `docs/06-diff-viewer.md` 和根 README。
- [x] 运行完整自动验证命令。
- [ ] 手动打开真实 diff 验证视觉效果。

## 关键决策

1. **不改 IPC 和 Rust 后端**：后端 hunk 数据已足够，缺口在前端渲染。
2. **单词 / 标识符优先**：行内匹配优先按单词和标识符片段对齐，避免跨不同变量名强行匹配零散字符；空格和符号变化仍能单独标出。
3. **低相似度跳过行内标注**：完全不同的 hash / ID 一类变更只保留行级背景，避免字符级标注产生噪音。
4. **标识符内分段**：snake_case / camelCase 标识符会按片段比较，让删除后缀和插入名称更容易看清。
5. **无内容侧占位**：新增只在旧侧空位置显示占位，删除只在新侧空位置显示占位；有实际变更内容的一侧不额外加占位。
6. **保留语法高亮**：先对整行做 highlight.js 高亮，再在文本节点范围内插入 mark，避免二选一。
7. **维持性能上限**：继续复用 `wordDiff.ts` 的超长行降级策略，避免单行 LCS 过重。

## 验证方式

1. 自动验证：
   - `npx vue-tsc --noEmit`
   - `npm run test`
   - `cd src-tauri && cargo check`
   - `cd src-tauri && cargo test`
2. 手动验证：
   - 打开包含单字符 / 空格变化的源码 diff。
   - 确认左右分栏、单列、按 hunk 分组和完整文件视图都显示具体变化位置。
   - 确认开启语法高亮后仍保留 token 颜色。
