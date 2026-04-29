---
name: release-notes
description: 生成 Release 发布日志。当用户要求“生成发布日志”、“生成 release notes”、“生成 changelog”，或为某个版本生成发布说明时使用。
---

# 生成发布日志

## 触发

用户要求为 GitUI 生成发布日志 / Release notes / Changelog。

如果用户提供版本号，支持 `X.Y.Z` 或 `vX.Y.Z`，输出时统一使用 `vX.Y.Z`。如果用户没有提供版本号，先从本地语义化 tag 中选择最新 tag 作为目标版本。

本 skill 只生成文本，不打 tag、不创建 GitHub Release、不推送。

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

5. 用模型总结主要变化，按固定格式输出。不要把提交列表机械改写成 changelog。
6. 复核输出：
   - `Release Page` 指向目标 tag。
   - `Full Changelog` 使用 `<from-tag>...<to-tag>`。
   - 发布提交本身没有进入任何条目。
   - 每条 bullet 是用户可理解的变化总结，而不是 hash 或原始提交标题堆砌。

## 输出格式

固定为：

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

## 分类规则

- `fix:` 通常归入 `🐞 Bug Fixes`。
- `feat:` 通常归入 `✨ Features`。
- `refactor:` / `style:` / `perf:` / `docs:` / `ci:` / `build:` / `test:` / `chore:` 通常归入 `🛠 Improvements`。
- Conventional Commit 前缀只是线索；最终按用户可见影响归类。
- 合并同类提交，优先写“这版主要带来了什么”，不要一条提交生成一条发布日志。
- 内部重构、测试、CI、文档只在对稳定性、可维护性或发布质量有明确价值时写入 `Improvements`。
- 忽略发布提交，例如 `chore: release vX.Y.Z`、`chore: 发布 vX.Y.Z`。

条目用简洁中文，避免提交 hash、文件名、函数名和过细实现细节。空分类保留标题但不输出占位文本。

## 异常处理

- 目标版本不是 `X.Y.Z` / `vX.Y.Z`：停下来说明版本格式不支持。
- 目标 tag 不存在：停下来说明需要先创建或拉取 tag。
- 找不到目标 tag 前一个语义化 tag：停下来说明无法生成比较区间。
- 远端不是 GitHub URL：仍可生成条目，但需要报告链接推导失败。
