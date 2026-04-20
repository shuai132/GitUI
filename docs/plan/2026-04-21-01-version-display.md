# 关于面板版本号最佳实践

## Context

当前行为：无论是 release tag 构建还是普通 commit 构建，关于面板始终显示 `v0.6.0-abc1234`。

目标：区分 release 和开发构建，遵循主流桌面应用的最佳实践：
- HEAD 精确在 `v*` tag 上 → 显示干净的 `v0.6.0`
- 其他情况（普通提交、CI 普通 push）→ 直接显示 `v0.6.0 (abc1234)`
- 关于面板文字支持鼠标选中复制

## 进度总览

| 阶段 | 状态 |
|------|------|
| build.rs 加 tag 检测 | ✅ 已完成 |
| build.yml CI tag 构建不注入 GIT_HASH | ✅ 已完成 |
| system.rs 过滤空字符串 | ✅ 已完成 |
| AboutInfo.vue 点击展开 + 可复制 | ✅ 已完成 |

## 子任务

- [x] `build.rs`：HEAD 精确在 `v*` tag 上时跳过 `GIT_HASH` 注入
- [x] `.github/workflows/build.yml`：tag 构建时 `GIT_HASH` 传空字符串
- [x] `src-tauri/src/commands/system.rs`：`option_env!("GIT_HASH")` 过滤空字符串
- [x] `src/components/common/AboutInfo.vue`：直接显示 `v0.6.0 (hash)` 格式 + `user-select: text`

## 关键决策

**判断 release 的时机在编译期（`build.rs`），而非运行时**
- 不依赖仓库路径（关于面板是全局面板，无 repo 上下文）
- 本地开发体验一致：HEAD 在 tag 上就是干净版本号，不需要额外配置

**直接显示完整版本串，无交互**
- `v0.6.0 (abc1234)` 格式简洁、无需点击即可复制
- 配合 `user-select: text` 支持鼠标选中复制

**CI 端补一道空字符串传递**
- `build.rs` 的 `option_env!` 只在未设置时跳过，CI 显式传空可确保 tag 构建时 `git_hash` 为 `None`
- Rust 端 `.filter(|s| !s.is_empty())` 兜底，防止空串漏过

## 行为矩阵

| 场景 | git_hash | 显示 |
|------|---------|------|
| 本地，HEAD 在 v* tag | null | `v0.6.0` |
| 本地，HEAD 不在 tag | `abc1234` | `v0.6.0 (abc1234)` |
| CI tag 构建 | null | `v0.6.0` |
| CI 普通 push | `abc1234` | `v0.6.0 (abc1234)` |

## 验证方式

1. 本地 HEAD 在 tag 上：`npm run tauri dev` → 关于面板显示 `v0.6.0`
2. 本地 HEAD 不在 tag 上：显示 `v0.6.0 (abc1234)`，可鼠标选中复制
3. 推 tag 后 CI 构建的关于面板显示干净 `v0.6.0`
