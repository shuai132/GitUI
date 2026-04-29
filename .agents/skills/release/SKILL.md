---
name: release
description: 仅当用户明确要求发布某个语义化版本时使用，例如“发布 1.2.3 版本”“发布 v1.2.3”
---

# 发布版本

## 版本号文件

三处必须一致：

- `package.json` — 顶层 `"version"`
- `src-tauri/Cargo.toml` — `[package]` 段的 `version`
- `src-tauri/tauri.conf.json` — 顶层 `"version"`

## 执行步骤

任一步失败立即停下来报错。

### 1. 前置检查

并发：

```bash
git status --porcelain
git rev-parse HEAD
git remote get-url origin
git rev-parse vX.Y.Z 2>/dev/null
```

- 工作区脏：停下来问用户是否继续（后面可能要生成提交，夹带别的改动会破坏提交粒度）。
- tag 已存在：停下来，让用户选换版本号或删除重建。
- 没有 `origin`：停下来报错。

### 2. 版本号一致性

读三个文件的当前版本号，跟目标 `X.Y.Z` 比。

- 三处都等于 `X.Y.Z`：跳到步骤 3。
- 否则：用 Edit 把不一致的 manifest 版本号改成 `X.Y.Z`，只允许直接修改这三处 manifest：

  - `package.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`

  **不要手工修改 lock 文件里的版本字段。**修改 manifest 后必须执行：

  ```bash
  npm install
  cd src-tauri && cargo check
  ```

  由工具根据 manifest 自动更新 `package-lock.json` 和 `src-tauri/Cargo.lock`。`cargo check` 会在 lock 缺失或过期时更新 `Cargo.lock`，同时避免 `cargo generate-lockfile` 重新解析并刷新依赖版本。若 `src-tauri/Cargo.lock` 除项目自身版本外出现依赖版本变动，停下来核对原因，不要把依赖升级夹进发布提交。然后只 add 这些文件（包括工具生成变更后的 `package-lock.json` 和 `src-tauri/Cargo.lock`）提交：

  ```bash
  git commit -m "chore: release vX.Y.Z"
  ```

### 3. 打 tag

```bash
git tag vX.Y.Z
```

用 lightweight tag，不带 message——发布信息在 commit 里已经写了。

### 4. 推送

- 步骤 2 产生了提交：`git push origin HEAD` 和 `git push origin vX.Y.Z` 分开跑。
- 否则：只 `git push origin vX.Y.Z`。

### 5. 回报

告诉用户：是否改过版本号文件、tag 名、指向的 commit（短 hash + 首行 message）、已推送的远程。

## 注意事项

- **版本号同步提交单独成条**：只含三个版本号文件及对应的 lock 文件（`package-lock.json` 和 `src-tauri/Cargo.lock`），不夹带其他改动。
- **不用 `git push --tags`**：只推本次这一个 tag。
- **失败不回滚**：push 失败保留本地 tag / commit，告诉用户让用户决定，不要擅自 `git reset` 或 `git tag -d`。
- **推送不用再确认**：skill 的语义就是推到 GitHub；只有前置/一致性检查异常才停下来确认。
