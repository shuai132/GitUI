# 工具栏操作 loading 状态按仓库隔离

## Context

`AppToolbar.vue` 的 pull / push / fetch / stash / pop / gc 六个按钮的"正在进行中"状态，当前保存在组件内一个全局 `reactive({ pull:false, push:false, ... })` 对象里，**不按 `repoId` 区分**，切换活动仓库时也没有任何清理。

现象：在 A 仓库点 Push 后立刻切到 B，B 的 push 按钮也会显示转圈（其实 B 根本没执行 push）；且切回 A 时即便后端任务仍在跑，按钮状态也可能与实际脱钩。

用户原话："pull 和 push fetch 这种，应该是关联到仓库的。而不是从 A 仓库切到 B，它还在 push 旋转"。

后端命令（`commands/remote.rs`、`commands/stash.rs`、`commands/system.rs::run_gc`）本身都是接 `repo_id` 的，语义本就按仓库隔离，只是前端 UI 把状态放错了层。

目标：把 busy 状态按 `repoId` 隔离，做到"A 转 B 不转、切回 A 继续转（若未完）、完成自动停"。

---

## 进度总览

| PR | 范围 | 状态 | 依赖 |
|----|------|------|------|
| PR 1 | 新增 `repoOps` store + AppToolbar 六个 op 改写 + `closeRepo` 清桶 | 已完成 | — |

单 commit 完成；无跨 PR 依赖。

---

## 一、新建 `src/stores/repoOps.ts`

- [x] 定义 `OpKind = 'pull' | 'push' | 'fetch' | 'stash' | 'pop' | 'gc'`
- [x] 内部 `busyMap: Record<repoId, Record<OpKind, boolean>>`，`ref` 持有
- [x] `getBusy(repoId: string | null): Record<OpKind, boolean>`：`null` 或未记录过返回全 false 的**常量快照**（避免每次产生新对象触发无关 re-render）
- [x] `setBusy(repoId, op, value)`：懒初始化桶后写入
- [x] `clearRepo(repoId)`：从 map 删除对应桶

## 二、改造 `src/components/layout/AppToolbar.vue`

- [x] 删除原有组件内 `reactive({pull, push, stash, pop, fetch, gc})`
- [x] `const busy = computed(() => repoOps.getBusy(repoStore.activeRepoId))`，模板中 `v-if="busy.pull"` 等写法保持不变（computed 会随 activeRepoId 切换自动返回对应桶）
- [x] 六个 op 函数在入口处用**局部变量** `const id = repoStore.activeRepoId` 锁住调用时刻的仓库，`try/finally` 里用该 `id` 调 `setBusy`——这样即使 await 期间用户切走，也不会清错别人家的标志

涉及函数：`onPull`、`doPush`、`onStash`、`onPop`、`onFetch`、`onActionsSelect` 中的 `case 'gc'`。

## 三、修改 `src/stores/repos.ts::closeRepo`

- [x] 关闭仓库时调用 `useRepoOpsStore().clearRepo(repoId)` 清桶，避免僵尸条目累积

---

## 关键决策

1. **按调用时刻的 repoId 记账**，而不是 finally 时读 `activeRepoId`。这是"保留各仓库真实状态"方案的前提，也避免切仓库竞态。
2. **getBusy 返回常量默认快照**：同一个 null/未知 repoId 多次读拿到同一引用，避免 computed 每次触发依赖方 re-render。
3. **stash/pop 也纳入**：虽然 `stashStore` 内部跨仓库正确性是另一个独立问题，本次只改 UI busy 层；stash store 的跨仓竞态单独评估。
4. **不持久化、不加取消**：进程退出时进行中的操作作废；后端同步 resolve/reject，`finally` 兜底就够。
5. **不在 IPC 加 level 之类的扩展**：纯前端状态管理改造，不动 Rust、不改 `docs/11-ipc.md`。

---

## 验证方式

- [ ] `npm run tauri dev` 启动开发环境
- [ ] 打开 A、B 两个仓库（A 选一个 remote 较慢的以延长观察窗口）
- [ ] A 点 Push，未完成时切到 B：B 的 pull/push/fetch 按钮均不转
- [ ] 切回 A，若后端未完成 → 继续转；完成后停转
- [ ] 对 pull / fetch / stash / pop / gc 分别复跑上述 A↔B 切换
- [ ] 关闭 A 再重新打开：按钮初始 false（`clearRepo` 生效）
- [x] `npx vue-tsc --noEmit` 通过（2026-04-17 本地验证）
- [x] `cd src-tauri && cargo check` 通过（未动 Rust，兜底）

---

## 关键文件

- 新增：`src/stores/repoOps.ts`
- 修改：`src/components/layout/AppToolbar.vue`
- 修改：`src/stores/repos.ts`（`closeRepo`）
