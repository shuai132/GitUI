# 丢失引用提交的单独移除

## Context

历史图在开启「显示丢失引用」开关时会把 HEAD reflog 里的不可达 commit 也画出来（`is_unreachable`）。用户希望能对单个这种提交单独执行「删除」，语义上类似对这一个 commit 做 gc，而不用整个跑一遍 `git gc`（那会连带清掉其他 unreachable，副作用大、耗时不可控）。

Git 本身不提供「删单个 object」的原子操作。但 GitUI 定义的"丢失引用"来源完全是 HEAD reflog——即：`get_log` 中 `include_unreachable` 分支会遍历 HEAD reflog，把既不在任何 ref 可达集合也不在 stash 集合里的 oid 推进 revwalk（`git/engine.rs::get_log`）。所以**从 HEAD reflog 里删掉所有指向该 oid 的 entry**，前端视图就会立刻看不到它；物理对象等后续 gc 自然回收（libgit2 默认 reflog 过期 90 天、unreachable 过期 30 天），和直接 gc 语义一致但无副作用。

这就是方案 A。方案 B（reflog 删条目 + `git gc --prune=now`）副作用太大已舍弃。

**目标**：在历史图 `is_unreachable === true` 的 commit 上加一条右键菜单项，二次确认后从 HEAD reflog 中抹掉所有 `new_oid == target` 的 entry，视图立即刷新。

---

## 进度总览

| PR | 范围 | 状态 | 依赖 |
|----|------|------|------|
| PR 1 | 后端 engine + IPC、前端 composable + 右键菜单、i18n、文档 | 已完成 | — |
| PR 2 | `is_reflog_tip` 字段 + 视觉分级 + 菜单按 tip 启用 | 已完成 | PR 1 |
| PR 3 | drop 扩展为"剥链"语义 + preview 预览条数 + 菜单不再禁用非 tip | 已完成 | PR 2 |
| PR 4 | 撤回视觉分级 + count=0 兜底提示 | 已完成 | PR 3 |
| PR 5 | 自定义 Modal 替代原生 confirm/alert（绕开 WebView 吞对话框） | 已完成 | PR 4 |

---

## 第二轮：Tip 语义（解决祖先链无效删除）

### 新的 Context

PR 1 落地后发现：当多个 unreachable commit 组成祖先链（a → b → c，a 是最新、c 是最老），删除 b 或 c 的 reflog entry 不会让它们从视图消失。因为 `get_log` 把 reflog 里每个 oid 都作为 revwalk 起点，从 a 出发仍然会递归遍历到 b、c——reflog entry 只是 revwalk 的"入口"，真正显示的是"入口闭包"。

另一种场景：b、c 从来没当过 HEAD（比如另一条被 `branch -D` 的分支的祖先），reflog 里根本没有它们的 entry，删除返回 `removed = 0`，用户仍看到它们在视图里。

**根因**：GitUI 的"丢失引用"视图是"HEAD reflog 闭包中的 commit"，不是"HEAD reflog 中出现的 oid"本身。

### 方案：引入 "reflog tip" 概念

一个 unreachable commit 是 **tip** 当且仅当：

1. 它的 oid **在** HEAD reflog 的某条 entry 的 `new_oid` 里出现过（"直接在 reflog 里"）
2. 它**不是**任何其他 reflog oid 的严格祖先（"没有更年轻的 reflog 入口能递归到它"）

Tip 才是"drop 一下就能看得见效果"的 commit。删掉一个 tip 之后，原本以它为后代的 commit 会升级成新的 tip（按剥洋葱节奏继续操作）。

### 子任务

- [x] `src-tauri/src/git/types.rs`：`CommitInfo` 新增 `is_reflog_tip: bool`（`#[serde(default)]`，unreachable 之外的场景默认 false）
- [x] `src/types/git.ts`：同步字段
- [x] `src-tauri/src/git/engine.rs::get_log`：Step D/E 后新增一步收集 `reflog_oids`，再跑一次辅助 revwalk 算 `strict_ancestors`（对每个 reflog_oid push 再跳过自身，收集其所有祖先）。主循环里 `is_reflog_tip = reflog_oids.contains(&oid) && !strict_ancestors.contains(&oid)`
- [x] 其他构造 `CommitInfo` 的点（`get_commit_detail`、`get_file_log`）字段填 false
- [x] `src/views/HistoryView.vue`：
  - [x] 模板 class 新增 `commit-dim-ancestor`（`is_unreachable && !is_reflog_tip` 触发）
  - [x] 样式 opacity 再降一档（0.6 → 0.4 左右）
  - [x] 右键菜单 `drop-unreachable` 项仅 `is_reflog_tip === true` 启用；disabled 时 tooltip 文案
- [x] i18n：新增 `history.contextMenu.dropUnreachableDisabledHint`（悬停或副标题）
- [x] `docs/11-ipc.md`：`CommitInfo` 字段说明补 `is_reflog_tip`
- [x] `docs/10-stash-reflog.md`：更新"从 reflog 中移除"段落，说明 tip 判定、祖先链处理和菜单禁用规则
- [x] `docs/05-commit-graph.md`：Unreachable 渲染说明补"两档灰度"
- [x] 本地校验 `npx vue-tsc --noEmit` + `cd src-tauri && cargo check`

### 关键决策

1. **严格 tip**：`is_tip` 要同时满足"在 reflog 里"和"没被别的 reflog oid 当祖先"。两者缺一不可——否则 a→b→c 场景下 a/b/c 都会被标记成 tip，菜单都启用，但删 b/c 仍然无效。
2. **不做批量"整条链删除"**：一键清链在交互上容易误删，先保留单步剥离。
3. **不刷新 strict_ancestors 缓存到 store**：tip 信息仅后端计算后塞进 `CommitInfo`，前端不做额外推演——数据流保持单向。
4. **视觉分两档而不是三档**：`is_stash` / `is_unreachable` 已经在原配色里占了两档，非 tip 的 unreachable 用比现有 dim 更浅的 opacity 即可，不必再拉出独立颜色。
5. **性能**：reflog 条目上限 500（`get_reflog` 的现有 limit 也是 500）；每个 reflog oid 的辅助 walk 命中集合会并集去重，总代价在大仓库里也在几毫秒级。大仓库实测如果过慢，再引入"tip 缓存随 reflog mtime 失效"。

---

## 第三轮：剥链语义（解决非 tip 无法直接操作）

### 反馈

PR 2 把非 tip 的菜单项设为 `disabled + opacity 0.5 + tooltip`。实测用户会把置灰项等同于"没有"，b/c 虽然也想操作却发现点不动；即使理解约束，按"先删 a 再删 b 再删 c"三次操作去剥链也体验差。

### 决策调整

- 对任一 unreachable commit 右键"从 reflog 中移除"都启用，不再按 tip 禁用
- 语义变为**剥链**：删除目标 oid 在 reflog 闭包里被引用的最小集合——等价于移除所有"祖先链包含目标 oid 的 reflog entries"
  - 点 tip a：只删指向 a 的 entry（没人把 a 当祖先）
  - 点中间 b：删指向 a 和 b 的 entries（a 是 b 的后代，链条要一并断）
  - 点尾端 c：删 a、b、c 三条
- 二次确认**事前**给出 N（"将从 HEAD reflog 中移除 N 条引用"），用户对影响范围有知情权
- 视觉分级保留：深色 = tip（点了影响小），浅色 = ancestor（点了会剥链、影响大）

### 子任务

- [x] 后端 `GitEngine::drop_unreachable_commit` 重写：
  - 收集所有 HEAD reflog entry 的 `(index, new_oid)`
  - 对每个 `new_oid`，若 `new_oid == target` 或从 `new_oid` 出发 revwalk 能遇到 `target` → 该 entry 命中
  - 从后往前 `reflog.remove`，命中非空时 `reflog.write()`；返回删除数
- [x] 新增 `GitEngine::preview_drop_unreachable_commit(path, oid) -> usize`：同样算法只返回计数，不动 reflog
- [x] 新增 Tauri 命令 `preview_drop_unreachable_commit`，注册到 `lib.rs`
- [x] `src/composables/useGitCommands.ts`：新增 `previewDropUnreachableCommit`
- [x] `src/stores/history.ts`：暴露 `previewDropUnreachableCommit` action
- [x] `src/views/HistoryView.vue`：
  - [x] 菜单项去除 `disabled: !c.is_reflog_tip`（`is_unreachable` 即启用）
  - [x] `case 'drop-unreachable'` 分支：先 `await previewDropUnreachableCommit` 拿 N，再 `confirm` 动态文案（按 N 展示）
  - [x] 删除只在 disabled 场景使用的 `title` tooltip（整项改为纯可点击）
- [x] i18n：
  - [x] `confirmDropUnreachable.body` 改为带 `{count}` 参数
  - [x] 删除 `dropUnreachableDisabledHint` key（没有 disabled 分支了）
- [x] 文档：`10-stash-reflog.md` 重写"剥链"段落；`11-ipc.md` 新增 `preview_drop_unreachable_commit`

### 关键决策

1. **剥链是"能让目标从闭包消失"的最少删除**：不是无脑删所有 reflog entry；算法判据是"该 reflog_oid 的闭包是否覆盖 target"，精确且可解释。
2. **用户点 c 会同时带走 a、b 的引用**：接受这种批量——用户已在对话框看到 N 数、知道影响面；希望保留 a 的人本来也不会点 c。
3. **preview 是单独 IPC 而非 `dry_run` 参数**：command 一事一议更清晰，也便于将来把 preview 嵌入 hover 提示等其它交互。
4. **视觉分级的意义改变**：不再表示"能否点"，而是"点它影响多大"。颜色深 = 影响小（tip），颜色浅 = 影响大（ancestor，会剥链）。保留分级以给用户视觉预判。
5. **仍然不自动 gc**：沿用 PR 1 的决策 4。
6. **`is_reflog_tip` 字段保留**：前端视觉分级仍用它；未来如果要在 diff 面板、badge 等处复用 tip 信息，也省一轮改动。

---

## 第四轮：撤回视觉分级 + 兜底提示

### 反馈

- **视觉**：用户认为"b/c 在删除之前不应该比 a 更浅"。之前用颜色深浅表达"点它剥链影响大"的隐喻让人困惑——b/c 尚未删除时应当和 a 一样都是"丢失引用"的标准灰。
- **交互**：用户点 b/c 的"从 reflog 中移除"时"没有二次弹窗"。最可能原因是旧进程未重启（`preview_drop_unreachable_commit` 是 PR 3 新增的 Rust 命令，需要重启 `tauri dev`），但代码侧没有任何失败反馈——`count=0` 也会静默走掉，用户无感。

### 决策

- **撤回视觉分级**：移除 `.commit-dim-ancestor` CSS 与模板 class 绑定，所有 unreachable 行共享同一档 dim（`.commit-dim`）。`is_reflog_tip` 字段在后端仍计算，留作未来 UI（如 hover 角标）备用；现阶段前端不消费。
- **count=0 兜底**：前端对 preview 返回 0 的情况弹一条明确 alert 说明"未找到相关 reflog entry，无需操作"。这样：旧进程调用新命令失败时由外层 `try/catch` 的 `alert(err)` 兜底；命令正常但命中 0 时由此兜底。用户至少能看到反馈，便于排查。

### 子任务

- [x] `src/views/HistoryView.vue`：
  - [x] 模板 class 绑定删 `commit-dim-ancestor`
  - [x] `<style>` 里 `.commit-row.commit-dim.commit-dim-ancestor ...` 规则删除
  - [x] `case 'drop-unreachable'` 分支里 `count === 0` 改为 alert 提示（保留 `loadLog` 刷新）
- [x] i18n：新增 `history.dialog.dropUnreachableEmpty`（中 / 英）
- [x] 文档：`docs/05-commit-graph.md`、`docs/10-stash-reflog.md` 回退"视觉分级 / 颜色深浅"描述，改为"`is_reflog_tip` 字段当前前端不使用"
- [x] `npx vue-tsc --noEmit` 通过（Rust 未改动，不跑 cargo check）

### 关键决策

1. **字段保留、视觉撤回**：后端计算有意义的信息（reflog tip vs ancestor）已经在了，前端是否 消费 是 UI 决策；两者解耦。
2. **静默 break 不可接受**：任何用户显式操作后，如果没有副作用，必须有可见的反馈（alert / toast / 数据更新）。PR 3 的实现里 count=0 分支静默 `loadLog`，应被当作 bug 修复。

---

## 第五轮：改用自定义 Modal

### 反馈

PR 4 用 `alert(...)` 兜底 count=0，用 `confirm(...)` 做二次确认。实测在 macOS Tauri 环境下原生 `alert` / `confirm` 被吞——用户点 b/c 菜单项后既没 confirm 也没 alert，表现为"静默无反应"。项目里其他地方（cherry-pick / revert 等）也有类似原生 confirm，只是那些用户之前没反馈过，可能偶发或只在某些 WebView 版本下复现。

### 决策

**走项目内 `Modal.vue`**，不再依赖原生 `window.confirm / window.alert`。Modal 是受控组件，在 DOM 里渲染，不依赖 WebView 对 JS dialog API 的支持度。

同一个 Modal 承载两种状态：
- `count > 0`：标题"从 reflog 中移除"，body 含 {count} + {shortOid} 说明，底部「取消 / 确认移除」
- `count === 0`：同标题，body 说明"无需操作"，底部只有「关闭」

### 子任务

- [x] `src/views/HistoryView.vue`：
  - [x] 新增 `dropUnreachableDialog = reactive({ visible, commit, count, submitting })`
  - [x] `case 'drop-unreachable'` 分支取消 `alert/confirm`，改为 preview 后填 reactive 并 `.visible = true`
  - [x] 新增 `onDropUnreachableConfirm` / `onDropUnreachableCancel`
  - [x] 模板末尾加 `<Modal>` 渲染两状态
  - [x] `.drop-unreachable-body` 样式
- [x] i18n：`history.dialog.confirmDropUnreachable` + `dropUnreachableEmpty` 合并重命名为 `history.dialog.dropUnreachable.{ title, body, emptyBody, confirm, close }`（中 / 英）
- [x] `npx vue-tsc --noEmit` 通过

### 关键决策

1. **Modal 组件复用现有的 `Modal.vue`**：和「修改提交信息」等其它 dialog 行为一致（Esc 关闭、遮罩点关闭、`<Teleport to="body">`）
2. **底部按钮按 count 条件渲染**：`v-if="count > 0"` 控制"确认"按钮是否出现，避免 count=0 场景下的无效操作
3. **不改其它地方的原生 confirm**：本次只修本功能——项目里其它 confirm 是否也要统一换 Modal 是独立决策，超出本 plan 范围
4. **保留 `submitting` 状态**：避免双击导致重复 IPC 调用

---

## 一、后端

### `GitEngine::drop_unreachable_commit(path, oid) -> GitResult<usize>`

- [x] 文件：`src-tauri/src/git/engine.rs`
- [x] 打开仓库、`repo.reflog("HEAD")`
- [x] 解析 target oid；从 `reflog.len() - 1` 向 `0` 倒序遍历，`reflog.get(i).id_new() == target` 时 `reflog.remove(i)`（从后往前删避免索引失效）
- [x] `reflog.write()` 落盘
- [x] 返回被删除的 entry 数；调用方可以据此提示"未命中"
- [x] 错误路径用 `GitError::OperationFailed(...)` 包装，和 `get_reflog` 保持一致

> 不写 stash guard：stash 的 commit_oid 本身是 reachable（`refs/stash` reflog 的 entry），`get_log` 不会把它标成 `is_unreachable`，前端也不会对 stash 行展示本菜单项。

### IPC 命令

- [x] 文件：`src-tauri/src/commands/system.rs`
- [x] `#[tauri::command] pub async fn drop_unreachable_commit(repo_id, oid, repo_manager) -> Result<usize, GitError>`
- [x] `src-tauri/src/lib.rs` 的 `tauri::generate_handler![]` 注册（放在 `get_reflog / run_gc` 附近）

## 二、前端

### composable

- [x] `src/composables/useGitCommands.ts` 新增 `dropUnreachableCommit(repoId, oid) => invoke<number>('drop_unreachable_commit', { repoId, oid })`，加入 return 导出

### 右键菜单

- [x] `src/views/HistoryView.vue`
- [x] `commitMenuItems` computed 里对 `c.is_unreachable === true` 的普通（非 stash）分支追加菜单项 `dropUnreachable`；放在"复制 SHA"后面，独立 separator 隔开
- [x] `onCommitMenuAction` 新增 `case 'drop-unreachable'`：`confirm` 二次确认（使用新 i18n key） → 调 `git.dropUnreachableCommit(repoId, oid)` → 成功后 `historyStore.loadLog()` 刷新视图
- [x] stash 行（`c.is_stash === true`）的分支早返回已有逻辑不动；仅 `c.is_unreachable === true && !c.is_stash` 触发

### i18n

- [x] `src/i18n/locales/zh-CN.ts` / `en.ts`
- [x] `history.contextMenu.dropUnreachable`：中"从 reflog 中移除" / 英"Remove from reflog"
- [x] `history.dialog.confirmDropUnreachable.body`：中"将 {shortOid} 从 HEAD reflog 中移除？对象本身仍由 git gc 自然回收，不影响其他丢失引用提交。" / 英类似表述

## 三、文档

- [x] `docs/11-ipc.md`：System 小节表格追加 `drop_unreachable_commit | repoId, oid | number (删除的 reflog entry 数)`
- [x] `docs/10-stash-reflog.md`：Reflog 节补一段，说明该命令的语义（"从视图里移除"，不等于物理删除；和 `run_gc` 的差别）

## 四、验证

- [x] `npx vue-tsc --noEmit` 通过（2026-04-18 本地验证）
- [x] `cd src-tauri && cargo check` 通过（2026-04-18 本地验证）
- [ ] 手动：在一个测试仓库里 `git commit` 若干条后 `git reset --hard HEAD~3` 制造几个 unreachable；开启"显示丢失引用"后，右键其中一个选新菜单项；确认后该行消失，其他 unreachable 仍在；HEAD reflog（Actions → 显示 Reflog）里对应 entry 确实没了
- [ ] 再次执行同一操作应返回 0 且前端不报错（幂等性）

---

## 关键决策

1. **语义是「从 reflog 移除」不是「物理删除」**。菜单项文案避免使用"删除"，用"从 reflog 中移除"，减少误解。
2. **幂等**：命令返回删除的 entry 数；重复执行 / 命中 0 条都不报错。
3. **只动 HEAD reflog**：不遍历 `refs/heads/*` / `refs/remotes/*` 的 reflog——因为 `get_log` 的 unreachable 来源就只有 HEAD reflog（见 `git/engine.rs::get_log` step E），其它 reflog 的 entry 本身就不会让 commit 显示为 unreachable。
4. **不自动 gc**：物理空间回收是全仓库级别的维护操作，沿用现有 Actions 菜单里的"清理仓库 (git gc)"入口，两者职责分开。
5. **不暴露为批量操作**：一次一个 oid，简单直接；有需要批量时用户可走全仓 gc。
6. **libgit2 原生 API**：不 fork 外部 git，和 `get_reflog` 同一条通路。
