# CI 产物名与「关于」页加入短 commit hash

## Context

`build.yml` 在 push / PR 时产出 GitHub Actions artifact 命名形如 `macOS-arm64-0.5.1`，多次提交对应的产物名相同，下载后无法区分对应的 commit；「关于」面板版本字段也只显示 `0.5.1`。需要把短 hash 加进 artifact 名以及 About 显示，便于追溯具体 build。

不修改 `tauri.conf.json` 的版本字段：避免污染 macOS `CFBundleShortVersionString` / Windows MSI ProductVersion 等平台元数据，影响代码签名与潜在的 auto-update。

## 进度总览

| 范围 | 状态 | 依赖 |
|------|------|------|
| 后端 build.rs 注入 GIT_HASH | 已完成 | — |
| 新增 `get_build_info` IPC | 已完成 | — |
| 前端 About 显示 `vX.Y.Z-hash` | 已完成 | 后端命令 |
| `build.yml` 加 hash 步骤 + 改 artifact 名 | 已完成 | — |
| 文档（11-ipc.md + 本文件） | 已完成 | — |
| CI 端到端验证（推一次 commit 看 artifact 名） | 未开始 | 用户操作 |

## 子任务清单

- [x] `src-tauri/build.rs`：读 `GIT_HASH` env 优先；否则跑 `git rev-parse --short HEAD`；通过 `cargo:rustc-env=GIT_HASH` 暴露；加 `rerun-if-changed=../.git/HEAD`、`../.git/refs`、`rerun-if-env-changed=GIT_HASH`
- [x] `src-tauri/src/git/types.rs`：新增 `BuildInfo { version: String, git_hash: Option<String> }`
- [x] `src-tauri/src/commands/system.rs`：新增 `get_build_info()`（同步命令，`env!("CARGO_PKG_VERSION")` + `option_env!("GIT_HASH")`）
- [x] `src-tauri/src/lib.rs`：在 System 区块注册 `get_build_info`
- [x] `src/types/git.ts`：加 `BuildInfo` interface（`git_hash: string | null`）
- [x] `src/composables/useGitCommands.ts`：加 `getBuildInfo()` 封装并在 return 中导出
- [x] `src/components/common/AboutInfo.vue`：移除 `getVersion`，改调 `getBuildInfo`，模板用 `versionLabel` computed 显示 `v{version}-{hash}`，hash 缺失时降级为 `v{version}`
- [x] `.github/workflows/build.yml`：新增 `Get short commit hash` step；`Build Tauri app` 加 `GIT_HASH` env；artifact 名改为 `${label}-${version}-${shortHash}`
- [x] `docs/11-ipc.md`：System 表新增 `get_build_info` 行；类型映射表新增 `BuildInfo` 行
- [ ] CI 端到端验证：推 commit 后确认 actions artifact 名正确、下载安装看「关于」字段（待用户操作）

## 关键决策

**做：**
- hash 走 Rust 编译期 env var → IPC 命令 → 前端展示。不依赖运行时跑 `git`（生产环境用户机器不一定有 git）
- About 总是带 `v` 前缀，与用户描述的 `v0.4.0-hash` 一致
- tagged release 仍上传到 GitHub Releases；其 bundle 文件名由 Tauri 默认规则产生（如 `GitUI_0.5.1_aarch64.dmg`），但 `GIT_HASH` 仍会注入二进制，因此「关于」面板对正式版也能看到 hash —— 故意保留，方便用户上报问题时附带精确构建信息

**不做：**
- 不改 `tauri.conf.json` 版本（污染平台元数据）
- 不改 Tauri bundle 输出文件名（无显著价值，且 tagged release 的 release 页面已经按 tag 区分）
- 不引 `vergen` 等 crate（手写 8 行 build.rs 足够）

## 验证方式

**本地：**
1. `cd src-tauri && cargo check` 通过
2. `npx vue-tsc --noEmit` 通过
3. `npm run tauri dev`，打开「关于」面板，应显示 `v0.5.1-<本地短hash>`
4. `git commit --allow-empty -m test` 后重启 dev，hash 应更新

**CI：**
1. push 测试 commit，到 Actions 页确认 artifact 名为 `macOS-arm64-0.5.1-<7位hash>`（其它两平台同理）
2. 下载 artifact 安装，「关于」面板应显示 `v0.5.1-<同样 hash>`
3. （可选）推一个测试 tag 验证：tagged 路径不上传 actions artifact、Releases 页 dmg 文件名仍是默认格式、「关于」字段显示带 hash
