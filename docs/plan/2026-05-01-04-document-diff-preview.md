# PDF / DOCX Diff Preview

## Context

GitUI 现有 diff 查看器支持文本、图片和 SVG，但 PDF / Word 文档只能按二进制文件提示，用户无法在应用内判断文档内容变化。目标是提供一个可维护的第一版：PDF / DOCX 文件在 diff 中进入文档预览分支，展示旧版 / 新版内容，并基于可提取文本做高亮 diff。

## 进度总览

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 1 | 完成 | 后端文档文本抽取 IPC |
| 2 | 完成 | 前端文档 diff 组件 |
| 3 | 完成 | 文档 / README / 测试 |
| 4 | 完成 | 类型检查、单元测试、Rust 校验 |

## 子任务清单

- [x] 新增 `extract_document_text` IPC，支持 blob 与工作区文件两类来源。
- [x] PDF 通过 `lopdf` 抽取文本；DOCX 通过 zip 读取 `word/document.xml` 并解析主要文本节点。
- [x] 扩展 `preview.ts`，识别 `pdf` / `docx` 文档预览类型。
- [x] 新增 `DocumentDiff`，加载旧 / 新两侧字节与文本，展示预览和文本差异高亮。
- [x] 更新 `DiffView` 分流逻辑。
- [x] 更新 `docs/06-diff-viewer.md`、`docs/11-ipc.md`、根 `README.md`。
- [x] 增加前端纯逻辑测试覆盖文档文本 diff 行构造。
- [x] 跑 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo fmt`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。

## 关键决策

- **做文本级高亮，不做页面坐标级高亮**：PDF / Word 的精确版式映射成本高，第一版只保证可提取文本的差异可读。
- **后端抽取文本**：PDF / DOCX 解析放在 Rust 侧，避免前端引入重型解析依赖，并复用现有 blob / worktree 读取边界。
- **预览和 diff 分离展示**：PDF 预览使用浏览器内置 PDF iframe；DOCX 第一版显示抽取文本预览。文本 diff 统一显示在预览下方。
- **沿用现有大小阈值**：文档字节读取继续受 `MAX_PREVIEW_BYTES` 限制；文本返回再做字符数截断，避免 IPC 和渲染过载。

## 验证方式

1. WIP 未暂存 PDF / DOCX 文件打开后能进入文档预览分支。
2. 已暂存 PDF / DOCX 文件打开后能基于 blob 内容显示旧 / 新两侧。
3. 提交详情中的 PDF / DOCX 文件能显示文档预览和抽取文本 diff。
4. 大文件超过阈值时显示不可预览 / 文本截断状态，不阻塞 UI。
5. 自动检查命令全部通过。
