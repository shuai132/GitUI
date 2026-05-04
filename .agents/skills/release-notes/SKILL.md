---
name: release-notes
description: 生成 Release 发布日志。当用户要求“生成发布日志”、“生成 release notes”、“生成 changelog”，或为某个版本生成发布说明时使用。
---

# 生成发布日志

## 触发

用户要求为 GitUI 生成发布日志 / Release notes / Changelog。

如果用户提供版本号，支持 `X.Y.Z` 或 `vX.Y.Z`，输出时统一使用 `vX.Y.Z`。如果用户没有提供版本号，先从本地语义化 tag 中选择最新 tag 作为目标版本。

本 skill 只生成 Release notes，不打 tag、不创建 GitHub Release、不推送。

在 Codex CLI 中，Markdown 会被终端渲染成列表和缩进，不适合从最终回答里直接复制原始 Markdown。默认把可复制正文写入临时 `.md` 文件；macOS 下如果 `pbcopy` 可用，同时复制到剪贴板。最终回答只报告文件路径、剪贴板状态和必要的简短说明，不把发布日志正文作为唯一复制来源。

## 工作流

1. 确认在当前仓库内执行。
2. 确定目标 tag：
   - 用户提供 `X.Y.Z` 或 `vX.Y.Z` 时，统一成 `vX.Y.Z`。
   - 用户未提供版本时，用本地最新语义化 tag 作为目标版本。
3. 确定起始 tag：从本地语义化 tag 中选择目标 tag 前一个版本。
4. 收集变更上下文：

   ```bash
   git tag --sort=-version:refname
   git log --no-merges --oneline <from-tag>..<to-tag>
   git remote get-url origin
   ```

   如果提交标题过于抽象，再按需补充查看相关提交的文件范围：

   ```bash
   git show --stat --oneline <commit>
   ```

5. 用模型总结主要变化，按约定顺序和格式生成 Release notes 正文。不要把提交列表机械改写成 changelog。
6. 把正文写入临时文件：

   ```bash
   /tmp/gitui-release-notes-vX.Y.Z.md
   ```

   文件内容必须是可直接粘贴到 GitHub Release 的原始 Markdown。`Release Page` 行末写入两个真实 ASCII 空格。
7. 如果当前系统有 `pbcopy`，执行：

   ```bash
   pbcopy < /tmp/gitui-release-notes-vX.Y.Z.md
   ```

   复制失败不影响文件生成，但最终回答要说明。
8. 复核输出文件：
   - `Release Page` 指向目标 tag。
   - `Full Changelog` 使用 `<from-tag>...<to-tag>`。
   - 发布提交本身没有进入任何条目。
   - 每条 bullet 是用户可理解的变化总结，而不是 hash 或原始提交标题堆砌。
   - 空分类不输出标题。
   - 所有正文行都从行首开始，不能有前导空格。
   - `Release Page` 行末有两个空格，确保 Markdown 换行。
9. 最终回答：
   - 不要把发布日志正文作为 Markdown 正文直接输出让用户复制。
   - 报告 `.md` 文件路径。
   - 报告是否已经复制到剪贴板。
   - 如果用户只是想查看效果，可以给简短预览，但必须说明复制以文件或剪贴板为准。

## 输出格式

按以下顺序组织；没有内容的分类整段省略：

```markdown
🐞 Bug Fixes
- 修复项

✨ Features
- 新功能

🛠 Improvements
- 改进项

Release Page: https://github.com/shuai132/GitUI/releases/tag/v0.8.0
Full Changelog: https://github.com/shuai132/GitUI/compare/v0.7.2...v0.8.0
```

格式要求：

- 分类标题固定使用英文：`🐞 Bug Fixes` / `✨ Features` / `🛠 Improvements`；只有在对应分类有内容时才输出，空分类连标题一起省略。
- 分类标题必须直接左对齐输出，前面不要加 `-`、`*`、数字序号或任何前导空格。
- 条目 bullet 也必须左对齐输出，形如 `- 修复项`，不要缩进。
- 分类之间用一个空行分隔。
- `Release Page` 和 `Full Changelog` 必须左对齐输出。
- `Release Page` 行末必须保留两个真实 ASCII 空格，用于 GitHub Markdown 强制换行；上方示例为了避免 skill 文件本身包含尾随空白，未展示这两个空格。
- Codex CLI 最终回答会渲染 Markdown，不适合作为复制源；可复制正文以生成的 `.md` 文件和剪贴板为准。
- 最终回答不要把发布日志整体包进列表、引用块、代码块或缩进块。
- 如果需要在最终回答里预览正文，必须明确“预览仅供查看，复制以文件或剪贴板为准”。

## 分类规则

- `fix:` 通常归入 `🐞 Bug Fixes`。
- `feat:` 通常归入 `✨ Features`。
- `refactor:` / `style:` / `perf:` / `docs:` / `ci:` / `build:` / `test:` / `chore:` 通常归入 `🛠 Improvements`。
- Conventional Commit 前缀只是线索；最终按用户可见影响归类。
- 合并同类提交，优先写“这版主要带来了什么”，不要一条提交生成一条发布日志。
- 内部重构、测试、CI、文档只在对稳定性、可维护性或发布质量有明确价值时写入 `Improvements`。
- 忽略发布提交，例如 `chore: release vX.Y.Z`、`chore: 发布 vX.Y.Z`。

条目用简洁中文，避免提交 hash、文件名、函数名和过细实现细节。空分类不输出标题，也不输出占位文本。

## 异常处理

- 目标版本不是 `X.Y.Z` / `vX.Y.Z`：停下来说明版本格式不支持。
- 目标 tag 不存在：停下来说明需要先创建或拉取 tag。
- 找不到目标 tag 前一个语义化 tag：停下来说明无法生成比较区间。
- 远端不是 GitHub URL：仍可生成条目，但需要报告链接推导失败。
