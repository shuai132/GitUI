# 02. 多仓库管理

GitUI 的核心使用场景是"同时挂着多个仓库，随时切换"。这份文档描述仓库的打开、切换、持久化、监控，以及窗口/托盘行为。

## 涉及模块

- 后端：`commands/repo.rs`、`repo_manager.rs`、`watcher.rs`、`tray.rs`、`lib.rs`
- 前端：`stores/repos.ts`、`components/layout/AppSidebar.vue`、`App.vue`
- 事件：`repo://status-changed`

## RepoManager

`repo_manager::RepoManager` 是一个纯"id ↔ path 名册"：

```rust
pub struct RepoManager {
    pub repos: Arc<parking_lot::Mutex<HashMap<String, RepoMeta>>>,
}
```

- 通过 `.manage(RepoManager::new())` 注册成 Tauri 全局 state
- 所有命令通过 `State<'_, RepoManager>` 注入，先用 `repo_id` 取出 `path`，再调 `GitEngine`
- `id` 是后端生成的 `Uuid::new_v4()` —— 每次 `open_repo` 会生成新的 id，即便同一路径重新打开也会换 id
- 前端根据 path 去重：`repos.ts::openRepo()` 发现同 path 已存在时直接激活，不会重复调 `open_repo`

### 为什么后端不缓存 status / dirty

早期版本里 `RepoCacheEntry` 还带了 `status: Option<WorkspaceStatus>` 和 `dirty: bool` 两个字段，计划让后端做 status 缓存 + watcher 触发增量推送。实际落地时发现：

- 前端 Pinia 已经是"单一事实来源"，活跃渲染状态都在 store 里
- 后端再存一份只会造成错位风险，且没有消费方真正读取
- 相关方法（`mark_dirty` / `get_cached_status`）长期挂 `#[allow(dead_code)]`

所以在 2026-04-11 的整理里把这些字段删掉了。`RepoManager` 现在只承担注册 / 查路径的职责。如果以后真的要做后端状态缓存，应该重新设计增量事件协议（`repo://status-delta` 等）而不是复活这份死代码。

### Mutex 选型

用 `parking_lot::Mutex` 而不是 `std::sync::Mutex`。两个理由：

1. 临界区都是 HashMap O(1) 查询，毫秒级以下 —— 但当前所有 Tauri command 是 `async fn`，`std::sync::Mutex::lock()` 会阻塞 tokio worker 线程，原则上是反模式。`parking_lot::Mutex` 非 async、但更快，且没有 `PoisonError` 需要 unwrap
2. 显式约束："所有临界区必须 O(1)、禁止持锁期间调 git2 或进行任何 IO"。违反这个约束后升级到 `tokio::sync::Mutex` 再说

`WatcherService` 内部的 `HashMap<repo_id, Debouncer>` 也用 `parking_lot::Mutex`，同样的理由。

## 创建仓库（clone / init）

「添加仓库」有三个入口，均统一收敛到同一套 menu + dialog：

- **工具栏**：`AppToolbar.vue` 的「新建」按钮（`+` 图标）点击直接弹「添加仓库」菜单，不再做 split-button 的默认动作
- **侧栏**：`AppSidebar.vue` 的 `+` 按钮行为一致，弹同一菜单
- **菜单项**：打开本地仓库 / 克隆远程仓库 / 新建本地仓库

菜单和 `CloneRepoDialog` / `InitRepoDialog` 都挂在 `App.vue` 顶层。状态由 `composables/useRepoCreation.ts` 用模块级 `ref` 持有（单例），各入口只调用 `showMenuAt(anchor)` / `openCloneDialog()` / `openInitDialog()`。

```
点击 + 按钮
  → useRepoCreation.showMenuAt(anchor)
  → 用户在 ContextMenu 中选 "克隆" / "新建"
    ├─ "克隆" → CloneRepoDialog
    │    → repoStore.cloneRepo({ url, parentDir, name?, depth?, recurseSubmodules })
    │    → invoke("clone_repo")
    │    → Rust 端 tokio::task::spawn_blocking（git2 是阻塞 C 库）：
    │        1. RepoBuilder + 凭据回调（复用 make_credentials_callback）
    │        2. transfer_progress / sideband_progress / checkout 回调
    │           节流后 emit "repo://operation-progress"（op="clone"）
    │        3. depth.is_some() 时 fetch_options.depth(N)
    │        4. recurse_submodules 时遍历 submodules 调 init+update
    │        5. 返回 workdir 绝对路径
    │    → repoStore.cloneRepo 内部再调 openRepo(workdir)（共用注册流程）
    └─ "新建" → InitRepoDialog
         → repoStore.initRepo(finalPath)
         → invoke("init_repo")
         → Rust 端 spawn_blocking：
             1. 路径不存在则 create_dir_all
             2. 已是 git 仓库则报错（避免覆盖）
             3. Repository::init(path)（非 bare）
             4. 返回 path
         → repoStore.initRepo 内部再调 openRepo(path)
```

**为什么 clone/init 不在后端直接注册到 RepoManager**：保持单一入口——所有"加入侧栏 + 启动 watcher + 持久化"的逻辑只在 `open_repo` 一处。clone/init 后端命令只负责"产出 workdir"，注册职责留给前端 store 委托给 `openRepo`，避免两份"添加仓库"代码漂移。

**进度事件节流**：`transfer_progress` 在大仓库里一秒可被回调几百次，无节流会让 IPC 风暴拖慢 UI。`commands/repo.rs::clone_repo` 在闭包内做"距上次 emit ≥100ms 或 stage 切换或 progress 跨 1% 才放行"的节流；`sideband_progress`（远端文本）稀疏不节流。

**bare 仓库**：`open_repo` 当前不支持 bare（`workdir().ok_or(...)`），`init_repo` 也不暴露 bare 选项。

**shallow 限制**：libgit2 的浅克隆支持有限——若日后某些远端表现出兼容问题，再考虑回退到 fork `git clone`（与现有 `git gc` 同等性质，作为唯一允许的外部 git 调用）。

## 打开流程

```
用户在侧栏 / 工具栏弹出的「添加仓库」菜单里选"打开本地仓库"
  → plugin-dialog openDialog({ directory: true })
  → reposStore.openRepo(path)
  → git.openRepo(path) → invoke("open_repo")
  → Rust open_repo:
      1. Repository::open() 验证是 git 仓库
      2. 取 workdir 名作为 repo.name
      3. 生成 Uuid 作为 repo.id
      4. RepoManager::add_repo(meta)
      5. WatcherService::watch(id, workdir, callback)
      6. 返回 RepoMeta
  → reposStore.repos.push(meta), activeRepoId = meta.id
  → 持久化 paths + activePath 到 gitui-repos.json
  → App.vue watch(activeRepoId) 触发:
      workspace.refresh + history.loadLog + history.loadBranches +
      submodules.loadSubmodules + stash.refresh
```

## 持久化

用 `@tauri-apps/plugin-store` 的 `LazyStore`：

| Key | Value |
|-----|-------|
| `paths` | `string[]`，所有已打开仓库的绝对路径（顺序即用户可见顺序） |
| `activePath` | 上次激活的路径 |

存储文件：`gitui-repos.json`（由 tauri-plugin-store 管理）。

启动时 `reposStore.loadPersisted()` 依次重新调 `open_repo` 恢复每个仓库（后端 `RepoManager` 是内存态，必须重新注册）。恢复过程中：

- 失败的路径会记录 `hasFailed` 标志
- 路径去重（历史数据可能有重复）
- 若有清理动作会把新列表回写

## 切换仓库

侧边栏"所有仓库"区域点击任一项 → `reposStore.setActive(repoId)`：

- 只改 `activeRepoId`，不调用任何后端命令
- `App.vue` 的 `watch(() => repoStore.activeRepoId)` 自动触发刷新链
- 路由强制跳到 `/history`
- 持久化 `activePath`

### 视图状态保存与恢复

切换仓库时，App.vue 会在 reset 之前把当前仓库的视图状态快照到 `reposStore` 的内存 Map（不持久化），包括：

- 当前选中的 commit oid（若有）
- WIP 行是否被选中
- WIP 面板里选中的文件路径

切回同一仓库时，新数据加载完成后自动恢复这份快照：commit 选中状态通过 `pendingJumpOid` 复用侧边栏跳转机制处理（含滚动到可见区域）；WIP 选中状态直接写入相关 store，WipPanel 挂载时读取并重新加载 diff。

## 侧边栏拖动排序

`AppSidebar.vue` 的"所有仓库"列表支持拖动重排。**不用 HTML5 DnD**：Tauri WKWebView 下 drag image / dropEffect / hit testing 都不稳定，改用 pointer events 自己实现：

- `pointerdown` 记录 `fromIndex`，移动超过 `DRAG_THRESHOLD = 4px` 才算拖动
- 拖动时按当前 Y 计算 `dragOverIndex` 和 `dragInsertBefore`，显示蓝色插入指示线
- `pointerup` 把 `(from, target)` 传给 `reposStore.reorderRepos`
- 拖动结束后 300ms 抑制 click，避免触发 `setActive`

"所有仓库"区域的高度本身也可拖动调整，持久化通过 `uiStore`（见下）。

## 仓库右键菜单

"所有仓库"列表里每一项支持右键，命令层见 `commands/system.rs`：

| 菜单项 | 命令 | 做了什么 |
|---|---|---|
| 在新窗口打开 | `open_in_new_window` | 启动一个**新的 GitUI 进程**（macOS: `open -n -a <bundle> --args --open-repo <path>`），新进程 `RepoManager`/watcher 独立 |
| 在 Finder 中显示 | — | 前端直接调 `@tauri-apps/plugin-opener` 的 `revealItemInDir(path)` |
| 在终端中打开 | `open_terminal` | 已存在命令，macOS 下 `open -a Terminal <path>` |

新进程 + `--open-repo` 的握手流程：

1. 父进程命令 `open_in_new_window` 用 `std::process::Command::spawn` 拉起同一可执行文件，传入 `--open-repo <path>`
2. 子进程 `lib.rs::run` 解析 `argv`，命中 `--open-repo` 时把 path 放进 `StartupRepo(Mutex<Option<String>>)` managed state
3. 子进程前端 `App.vue::onMounted` 先走 `loadPersisted()`，再调 `consume_startup_repo` 取走该 path，命中则 `repoStore.openRepo(path)` 激活

取走后状态清空，保证只生效一次。已知限制：当前没做 single-instance 抑制，第二个进程会再注册一个 tray 图标。

## UI 偏好持久化

除了仓库列表（走 `plugin-store` 的 `gitui-repos.json`），所有用户 UI 偏好统一由 `stores/ui.ts` 管理，后端数据用 `localStorage`。之所以仍用 `localStorage` 而不是 `plugin-store`：纯 UI 偏好不需要跨进程 / 跨仓库访问，localStorage 同步写入更简单。

关键是**读写必须经过 store**，组件里不再直接调 `localStorage.getItem` / `setItem`。这样：

- 偏好清单一览表就是 `ui.ts` 的 state 列表
- 未来要做"导出 / 重置所有偏好"时只改 store 一个文件
- 测试时 mock store 就能控制所有偏好

### 当前偏好清单

| state 字段 | localStorage key | 默认值 | 说明 |
|------|------|-------|------|
| `sidebarWidth` | `gitui.sidebar.width` | `220` | 主侧栏宽度 |
| `reposHeight` | `gitui.sidebar.reposHeight` | `160` | "其他仓库"面板高度 |
| `historyLayoutMode` | `gitui.history.layout` | `'vertical'` | 历史详情面板布局 |
| `showUnreachableCommits` | `gitui.history.showUnreachable` | `false` | 显示丢失引用的提交 |
| `showStashCommits` | `gitui.history.showStashes` | `true` | 显示 stash 作为提交 |
| `historyPaneSizes` | `gitui.history.sizes`（JSON blob） | 见 store | 历史视图的分割百分比 + 三列宽度 |
| `diffViewMode` | `gitui.diff.viewMode` | `'side-by-side'` | diff 模式 |
| `diffHighlightEnabled` | `gitui.diff.syntax-highlight` | `true` | diff 语法高亮开关 |
| `historySearchQuery` | —（不持久化） | `''` | 当前历史搜索词 |

### 写入时机

拖动类偏好（`sidebarWidth` / `reposHeight` / `historyPaneSizes`）走"拖动中只改响应式、pointerup 时持久化"模式——避免拖 100 像素写 100 次 localStorage。store 对这类字段提供 `persistXxx()` 方法，组件在 pointerup 时调用。

其他 toggle / 选择类偏好（layout mode、show*、diff mode、高亮）直接 setter 写入。

## 文件系统监控

`WatcherService` 包装 `notify-debouncer-mini`：

```rust
pub fn watch<F>(
    &self,
    repo_id: String,
    watch_root: PathBuf,
    ignore_filter: Option<Arc<IgnoreFilter>>,
    callback: F,
) -> notify::Result<()>
where
    F: Fn(DebounceEventResult) + Send + 'static
```

- 每个 `repo_id` 对应一个 `Debouncer`，防抖 **300ms**
- 监控的是 **整个工作目录**（不是 `.git/`）。只监听 `.git/` 会漏掉 tracked 文件的编辑，无法刷新 status
- 回调里 `app.emit("repo://status-changed", repo_id)`
- `close_repo` 时 `watcher.unwatch(repo_id)` 释放

### gitignore 过滤

"监听整个工作目录"的副作用是 `node_modules/` / `target/` / `.venv/` / `dist/` 里的任何变动都会触发 debounce 和前端 `get_status`——大型项目里构建或依赖安装会让 watcher 疯狂抖动。

解决方案：**打开仓库时读 `.gitignore`，构造 `ignore::gitignore::Gitignore` matcher，在 watcher 回调里按路径前置过滤**。

实现细节：

1. `commands/repo.rs::open_repo` 调 `IgnoreFilter::build(workdir)` 构造一个 `Arc<IgnoreFilter>`，传给 `watcher.watch()`
2. `IgnoreFilter::build` 用 `ignore::gitignore::GitignoreBuilder` 读 `<workdir>/.gitignore`（若存在），再加一条硬编码的 `.git/` —— 虽然 git 会自动排除 `.git`，但这里额外兜底
3. `watcher.rs` 在包装 callback 时遍历 `DebouncedEvent`，对每个事件：
   - **`.git/` 内部路径永远放行**（HEAD / refs / index 变化是我们最关心的信号）
   - 其他路径用 `Gitignore::matched_path_or_any_parents(rel, is_dir)` 判断，命中 ignore 就丢弃
4. 一批事件全被过滤后就不 emit 任何事件；留下至少一条就照常 emit

### 限制 / 已知不完美

- **只读仓库根的 `.gitignore`**：嵌套子目录里的 `.gitignore`、`.git/info/exclude`、全局 `core.excludesfile` 都不参与匹配。对主要痛点场景（`node_modules` / `target` / `dist`）足够——这些目录几乎都由根 `.gitignore` 管理
- **`.gitignore` 本身变化时不会自动重建 matcher**：用户改了 `.gitignore` 需要关闭再打开仓库才会生效。第一版不自动重建，避免增加同步复杂度
- **刚 clone 但 `.gitignore` 尚未 tracked 的文件**：matcher 是在 `open_repo` 时构造的一次性快照，之后永远不变（直到仓库重新打开）

前端 `useGitEvents.onStatusChanged` 订阅：

```ts
onStatusChanged((repoId) => {
  if (repoId === repoStore.activeRepoId) {
    workspaceStore.refresh(repoId)
    submodulesStore.loadSubmodules()
  }
})
```

只响应当前激活的仓库——其他仓库的变动仅缓存在后端，不触发前端渲染。

## 窗口与托盘

### 关闭 = 隐藏

`lib.rs`:

```rust
.on_window_event(|window, event| {
    if let WindowEvent::CloseRequested { api, .. } = event {
        window.hide().unwrap();
        api.prevent_close();
    }
})
```

### 托盘（`tray.rs`）

- 菜单：`显示窗口`、`退出`
- 左键点击 tray icon → 显示并聚焦窗口
- 只有点"退出"才真正 `app.exit(0)`

### macOS 细节

`App.vue` / `AppToolbar.vue` 在 macOS 下留 78px 给 traffic lights，工具栏整体承担窗口拖动区域（`data-tauri-drag-region` + `startDragging`）。双击工具栏空白区域切换最大化。
