# Markdown Diff Preview

## Context

GitUI 的 Diff 查看器已经支持文本、图片/SVG，以及 PDF / DOCX / PPTX 的文档预览。Markdown 文件目前只能按源码 diff 阅读，用户无法在应用内直观看到 README、说明文档等渲染后的变化。目标是在不改变现有 IPC 契约的前提下，为 Markdown 文件增加安全的渲染预览，并保留源码 diff 的精确行级操作能力。

## 进度总览

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 1 | 完成 | 计划文档与依赖 |
| 2 | 完成 | Markdown 渲染 helper 与共享文本加载 |
| 3 | 完成 | 前端 MarkdownDiff 组件与分流 |
| 4 | 完成 | 文档、测试与检查 |

## 子任务清单

- [x] 加入 HTML sanitizer 依赖，避免仓库 Markdown 原始 HTML 直接进入 WebView。
- [x] 新增 Markdown 渲染 helper，封装 marked、DOMPurify、链接与图片策略。
- [x] 抽出 diff 两侧文本读取/解码逻辑，供完整文件 diff、Vue SFC 高亮和 Markdown 预览复用。
- [x] 新增 `MarkdownDiff`，展示并排渲染预览和下方源码 diff。
- [x] 扩展 `preview.ts` 与 `DiffView` 分流逻辑。
- [x] 更新 `docs/06-diff-viewer.md` 与 README。
- [x] 增加前端测试覆盖 Markdown 预览检测、渲染安全与组件行为。
- [x] 跑 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo fmt`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。

## 关键决策

- **预览 + 源码 diff**：上方并排渲染旧 / 新 Markdown，下方保留现有行级 diff；hunk 操作、变更跳转和搜索仍基于源码 diff。
- **不新增 IPC**：Markdown 是文本格式，前端复用现有 blob / worktree 内容读取接口，不扩展 `docs/11-ipc.md`。
- **安全净化 HTML**：使用 DOMPurify 过滤渲染后的 HTML；Markdown 中的脚本、事件属性和危险 URL 不允许执行。
- **v1 不加载 Markdown 图片资源**：图片渲染为占位，链接只允许安全协议并通过系统浏览器打开；相对链接不跳转。

## 验证方式

1. WIP 未暂存、已暂存、提交详情中的 Markdown 文件能进入预览分支。
2. 新增 / 删除 Markdown 文件能正确显示单侧缺失状态。
3. 渲染预览与源码 diff 的分割比例可拖动并持久化。
4. Markdown 中的脚本、事件属性、危险链接和图片不会在 WebView 中执行或加载。
5. 下方源码 diff 的布局切换、按 hunk 分组、变更跳转和 hunk 操作保持可用。
6. 自动检查命令全部通过。
