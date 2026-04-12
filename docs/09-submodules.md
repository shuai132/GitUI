# 09. Submodule

GitUI 对 submodule 的目标是"让父仓库 + 子仓库像两个独立仓库那样操作"。侧边栏显示当前仓库的所有 submodule，可以 init / update / 改 URL / 完整 deinit，也可以直接把一个已克隆的 submodule 当作新仓库打开。

## 涉及模块

- 后端：`commands/submodule.rs`、`GitEngine` 的 submodule 系列方法
- 前端：
  - `stores/submodules.ts`
  - `components/layout/AppSidebar.vue` 的 SUBMODULES section
  - `components/submodule/EditSubmoduleDialog.vue`
- 数据类型：`SubmoduleInfo`、`SubmoduleState`

## 状态分类

```rust
pub enum SubmoduleState {
    Uninitialized,  // .gitmodules 有但 .git/config 没注册
    NotCloned,      // init 了但工作区没 clone（WD_UNINITIALIZED）
    UpToDate,       // workdir commit == 父记录 && 工作区干净
    Modified,       // workdir commit 偏离 && / || 工作区有本地修改
    NotFound,       // .gitmodules 有但磁盘上完全找不到
}
```

分类逻辑在 `GitEngine::classify_submodule_state`：

1. 既不在 `wd / config / index / head` → `NotFound`
2. 不在 `config` → `Uninitialized`
3. `wd_uninitialized` → `NotCloned`
4. 任何 wd / index 的 dirty 标志 → `Modified`
5. 否则 → `UpToDate`

`SubmoduleInfo` 同时附带 `has_workdir_modifications`（`wd_wd_modified || wd_index_modified || wd_untracked`）供 UI 显示橙色小点。

## 侧边栏 UI

```
SUBMODULES   N
  📦 path/to/sub        •     ⋮
  ⚠️ path/to/sub              ⋮   ← uninit/not_cloned/not_found
```

- 立方体图标（正常） vs 警告三角（未 init / 未 clone / 找不到）
- `has_workdir_modifications` 时右侧显示橙色圆点
- hover 时显示三点 kebab 按钮（避免视觉噪声）
- kebab 定位在按钮右下方（不跟随鼠标），视觉更稳定
- 悬停 tooltip 显示 path + URL

### 点击行为

```ts
async function onSubmoduleClick(s) {
  if (未初始化 / 未 clone / 不存在) return
  const absPath = await submodulesStore.workdir(s.name)
  await repoStore.openRepo(absPath)
}
```

点击已克隆的 submodule 会通过后端 `submodule_workdir(parent, name)` 拿到绝对路径，然后调 `open_repo` 把它加到仓库列表里，自动变成第二个仓库可独立切换。

### kebab 菜单

| 菜单项 | 条件 | 动作 |
|--------|------|------|
| Initialize `<path>` | 未初始化才可用 | `init_submodule` |
| Update `<path>` | 总可用 | `update_submodule`（含 clone + checkout） |
| Edit `<path>` | 总可用 | 打开 `EditSubmoduleDialog` |
| Delete this submodule | 总可用，danger | `deinit_submodule` |

## 后端命令

### `init_submodule(name)`

仅注册到 `.git/config`，不 clone。调 `sub.init(false)`。

### `update_submodule(name)`

克隆缺失的 submodule 并 checkout 到父记录的 commit。走 `SubmoduleUpdateOptions` + 凭据回调（复用 `credential_callback`）。

### `set_submodule_url(name, new_url)`

```rust
repo.submodule_set_url(name, new_url)?;
if let Ok(mut sub) = repo.find_submodule(name) {
    let _ = sub.sync();  // 把 .gitmodules 的 url 同步到 .git/config
}
```

对应 `EditSubmoduleDialog.vue` 的 URL 编辑流程。

### `submodule_workdir(name) -> String`

```rust
let sub = repo.find_submodule(name)?;
let abs = repo.workdir()?.join(sub.path());
if !abs.exists() {
    return Err("Submodule 工作区不存在");
}
Ok(abs.to_string_lossy().to_string())
```

### `deinit_submodule(name)` — 完整清理

普通 `git submodule deinit` 会留下残留（`.git/modules/<name>`、`.gitmodules` 的 section），GitUI 的 deinit 做了一次性完整清理：

1. **删 `.git/modules/<name>/`**：`fs::remove_dir_all`
2. **删工作区目录**：`fs::remove_dir_all(workdir.join(sub_path))`
3. **改 `.gitmodules`**：`strip_gitmodules_section` 按 `[submodule "<name>"]` header 剥离那一段
   - 若剩余内容全是空白 / 注释 → 整个文件删掉
4. **改 `.git/config`**：遍历所有 `submodule.<name>.*` 条目删除
5. **更新 index**：`index.remove_path(sub_rel_path)` + 根据 `.gitmodules` 是否还存在决定 `add_path` 还是 `remove_path`

操作完成后 index 是一个待提交状态，用户手动 commit 即可得到一个"删除 submodule"的提交。提示语在前端 confirm 里明确说明了：

```
这将删除：
  • 工作区目录 path/
  • .git/modules/<name>/
  • .gitmodules 中对应条目
  • .git/config 中对应条目

操作完成后请手动 commit 这次变更。
```

### `list_submodules(path)`

遍历 `repo.submodules()`，每条跑 `submodule_status` 和分类函数，返回 `Vec<SubmoduleInfo>`。

## 刷新时机

- 切换仓库（`App.vue` 的 watcher）
- 文件系统变更事件（`useGitEvents.onStatusChanged`）
- init / update / setUrl / deinit 后由 store 内部 await `loadSubmodules`

## 关键决策

- **点击 submodule 打开为新仓库，而不是 "跳进子目录"**：两个仓库并存在侧边栏，可以随时切换 / 并排看 diff，符合多仓库定位
- **deinit 是真删除，不是 git 原生的 "deinit"**：原生 deinit 只清工作区 + `.git/config`，但留下 `.git/modules/<name>` 和 `.gitmodules` 条目。GitUI 一次性清干净，配合 UI 说明让用户知道发生了什么
- **不递归追踪嵌套 submodule**：只列当前仓库的直接 submodule，嵌套的子子模块需要用户自己打开上一级处理
