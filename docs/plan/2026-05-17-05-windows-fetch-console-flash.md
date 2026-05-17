# 修复 Windows Fetch 黑框闪现

## Context

Windows 上对 SSH remote 执行 Fetch / Fetch All 时，GitUI 会 fallback 到系统 `git.exe`，以复用用户已有的 OpenSSH、ssh-agent 和 `~/.ssh/config`。现有实现已经对 GitUI 直接启动的 `git.exe` 设置 `CREATE_NO_WINDOW`，但 Git for Windows 后续再启动 `ssh.exe` 等子进程时，部分机器仍可能出现短暂控制台黑框。

本次目标是隐藏 GitUI 后台远程同步链路中的 Git / SSH 子进程窗口，同时保持现有 SSH fallback、Fetch 后刷新远程 tag、HTTPS 走 libgit2 的行为不变。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 1 | 已完成 | 集中封装 Git shellout 的隐藏启动配置 |
| 2 | 已完成 | Windows 下增加 GitUI 内置 SSH proxy |
| 3 | 已完成 | 更新远程操作文档并完成检查 |

## 子任务清单

- [x] 新增 Windows SSH proxy 入口，proxy 模式不启动 Tauri UI。
- [x] `run_git()` 使用统一的隐藏 shellout 配置。
- [x] SSH clone 复用同一套 Git shellout 构造逻辑。
- [x] Windows 下为 Git shellout 注入 `GIT_SSH` / `GIT_SSH_VARIANT`，让真实 `ssh.exe` 由 GitUI proxy 隐藏启动。
- [x] 保留用户显式 SSH 命令配置，不主动覆盖高级配置。
- [x] 更新 `docs/08-remote.md` 的 Windows SSH shellout 说明。
- [x] 运行 Rust 与前端回归检查。

## 关键决策

- **做 GitUI 内置 SSH proxy**：`CREATE_NO_WINDOW` 只覆盖 GitUI 直接创建的进程，不能保证覆盖 Git 再创建的 SSH 进程；让 Git 通过 GitUI proxy 启动 SSH，可以把真实 `ssh.exe` 的隐藏窗口策略纳入 GitUI 控制。
- **不改变 Fetch 后刷新远程 tag**：工具栏 Fetch 成功后继续刷新远程 tag 状态，避免用减少子进程次数换取不完整的同步状态。
- **不改变 HTTPS 路径**：HTTPS remote 继续走 libgit2 与现有凭据回调链，避免扩大改动面。
- **不覆盖显式高级 SSH 配置**：如果用户环境或 Git 配置中已经设置了专用 SSH 命令，本次不强行替换，降低破坏自定义链路的风险。

## 验证方式

- `npx vue-tsc --noEmit`
- `npm run test`
- `cd src-tauri && cargo check`
- `cd src-tauri && cargo test`
- Windows 手动验证：SSH remote 点击 Fetch All 不闪黑框；Fetch 后远程 tag 状态仍刷新；多 remote 和 auto-fetch 不产生控制台闪窗；HTTPS remote 行为不变。
