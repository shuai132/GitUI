---
name: release
description: 创建并推送 git tag 发布新版本。当用户说"发布 X.Y.Z 版本"（例如"发布0.1.0版本"、"发布 1.2.3 版本"、"发布 v2.0.0 版本"）时使用，会创建 annotated tag vX.Y.Z 并推送到远程 origin，从而触发 GitHub 发布流程。
---

# 发布版本

## 触发

用户说"发布 X.Y.Z 版本"，其中 X.Y.Z 是语义化版本号。允许用户带或不带 `v` 前缀、带或不带空格。例如：

- 发布0.1.0版本
- 发布 1.2.3 版本
- 发布 v2.0.0 版本

从用户输入中提取纯数字版本号 `X.Y.Z`，tag 名始终带 `v` 前缀。

## 执行步骤

按顺序执行，任一步失败立即停下来报错，不要继续。

### 1. 前置检查

并发执行以下检查：

```bash
git status --porcelain           # 工作区是否干净
git rev-parse HEAD               # 当前 HEAD
git remote get-url origin        # 确认 origin 存在
git rev-parse vX.Y.Z 2>/dev/null # tag 是否已存在（存在即返回 hash，不存在返回非零）
```

- 若工作区有未提交改动：提示用户，询问是否仍要在当前 HEAD 打 tag。
- 若 tag `vX.Y.Z` 已存在：**停下来**告诉用户，询问是要换版本号还是删除重建（删除重建需要用户明确确认）。
- 若没有 `origin` 远程：停下来报错。

### 2. 创建 annotated tag

```bash
git tag -a vX.Y.Z -m "Release X.Y.Z"
```

使用 annotated tag（`-a` + `-m`），便于 `git describe` 和 GitHub Release 页面展示。

### 3. 推送 tag 到远程

```bash
git push origin vX.Y.Z
```

### 4. 回报结果

完成后告知用户：
- tag 名（`vX.Y.Z`）
- 指向的 commit（短 hash + 首行 message）
- 已推送到的远程（通常 `origin`）

## 注意事项

- **只推 tag，不推分支**：`git push origin vX.Y.Z` 只推送该 tag，不要用 `git push --tags` 或 `git push origin main`，避免把用户未准备好推送的本地提交一起推出去。
- **不自动改版本号文件**：不要擅自修改 `package.json`、`Cargo.toml`、`src-tauri/tauri.conf.json` 等文件里的版本号。用户如果要同步版本号，会单独要求。
- **推送是对外可见操作**：本 skill 的既定语义就是推到 GitHub，执行即可，不需要再次向用户确认。但若前置检查发现异常（工作区脏、tag 已存在），必须先停下来确认。
- **失败不回滚**：如果 tag 创建成功但 push 失败，保留本地 tag，把错误告诉用户，让用户决定是重试 push 还是 `git tag -d` 删除本地 tag。不要自作主张回滚。
