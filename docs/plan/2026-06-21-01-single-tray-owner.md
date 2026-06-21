# 单一托盘 Owner 与多窗口仓库协议

## Context

GitUI 当前每个进程都会创建自己的托盘图标，且主窗口关闭会直接退出进程。多窗口场景下这会产生多个托盘入口，关闭某个窗口时也缺少一套跨进程的窗口存活、active repo 同步和托盘菜单协议。

本次实现一个跨进程 `TrayCoordinator`，用文件锁选出唯一托盘 owner。owner 维护当前存活窗口 registry，并只在菜单中展示仍存活窗口的 active repo。采用“保持原托盘”策略：owner 窗口关闭后，如果还有其他窗口存活，owner 进程可以隐藏窗口并继续托管原托盘，避免 macOS 菜单栏图标消失、换位或重建抖动。

预期结果：

- 任意数量 GitUI 进程只出现一个托盘图标。
- 托盘菜单只列出当前仍有存活窗口且有 active repo 的仓库。
- 关闭 owner 窗口时，只要仍有其他窗口，原托盘保留且窗口项继续可唤起。
- active repo 的后端 watcher / auto-fetch 同步由有序 generation 保护，避免快速切换或关闭时旧 IPC 覆盖新状态。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 1 | 已完成 | 新增 `TrayCoordinator`、owner lock/state、TCP registry 和托盘菜单驱动 |
| 2 | 已完成 | 重做窗口关闭、Dock Reopen、`open -a` 唤起路径 |
| 3 | 已完成 | 修改 `set_active_repo` / `close_repo` IPC generation 事务 |
| 4 | 已完成 | 前端 repos store 接管 active repo 同步并补测试 |
| 5 | 已完成 | 更新 docs / README 并跑验证 |

## 子任务清单

- [x] 增加 `fs2` 依赖和 `TrayCoordinator` 管理状态。
- [x] owner 用 app data lock file 选主，绑定 loopback TCP listener，并写入带随机 token 的 owner state 文件。
- [x] 非 owner 进程连接 owner，注册 `window_id`、pid 和 active repo；断线时 owner 清理 registry。
- [x] owner 托盘菜单由 registry 生成，支持同名仓库标签消歧、点击仓库项跨进程唤起窗口、左键唤起最近活跃窗口。
- [x] 关闭窗口按 owner / 非 owner / 是否仍有其他窗口分支处理，关闭窗口时停止 watcher 和 auto-fetch。
- [x] `set_active_repo(repoId, generation)` 按 generation 忽略旧请求，并同步 coordinator registry。
- [x] `close_repo(repoId, nextActiveRepoId, generation)` 在同一命令内原子切换或清空后端 active 状态。
- [x] 前端 `repos` store 集中生成 generation，`openRepo` / `setActive` / `closeRepo` 主动调用 IPC。
- [x] `App.vue` 移除 active repo 后端同步 watcher，仅保留数据刷新 watcher。
- [x] 补充后端和前端单元测试。
- [x] 同步更新 `docs/02-repo-management.md`、`docs/11-ipc.md` 和根 `README.md`。
- [x] 运行格式化、类型检查、前端测试、Rust check/test。

## 关键决策

- 托盘 owner 不读取持久化仓库列表，只展示当前存活窗口的 active repo，避免把已经关闭的窗口误作为可唤起目标。
- owner 窗口逻辑关闭但仍有客户端窗口时，owner 进程继续存活并保留原托盘；Dock Reopen 和托盘“显示”优先唤起存活客户端，不重新显示逻辑已关闭窗口。
- 跨进程通道只绑定 `127.0.0.1`，owner state 写入随机 token；消息必须带 token 才处理，避免把本地端口暴露成无鉴权接口。
- `window_id` 是每进程生成的稳定 UUID。当前每个进程只有一个 `main` webview window，但协议按窗口粒度命名，给未来同进程多窗口保留扩展空间。
- active repo 后端状态只接受单调递增 generation。关闭 active repo 时前端先计算 next active，并通过同一个 `close_repo` 命令让后端同步切换 watcher / auto-fetch / tray registry。

## 验证方式

- 后端单元测试覆盖 registry 增删 / 移除、同名仓库菜单标签消歧、最近活跃窗口选择、owner state 读写和 generation 乱序。
- 前端单元测试覆盖 `repos.closeRepo` 传入 next active + generation、快速切换 generation 单调递增、关闭非 active repo 不触发 active repo IPC。
- 手动验证：
  - 打开 A/B/C 三个新窗口，只出现一个托盘图标。
  - 托盘右键只列出当前存活窗口的 active repo；关闭任一窗口后对应项消失。
  - 点击 A/B/C 菜单项分别唤起对应窗口。
  - 关闭 owner 窗口后托盘不消失、不换位置，菜单仍列出其他窗口。
  - 快速任意顺序关闭 A/B/C，不崩溃，不残留 watcher / auto-fetch，不出现 active repo 指向已关闭仓库。
  - macOS Dock Reopen、`open -a GitUI <path>`、tray click/menu callback 不 panic abort。
- 提交前检查：
  - `cd src-tauri && cargo fmt`
  - `npx vue-tsc --noEmit`
  - `npm run test`
  - `cd src-tauri && cargo check`
  - `cd src-tauri && cargo test`
