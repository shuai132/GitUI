# ConflictView 重构方案

## Context

`src/components/diff/ConflictView.vue` 当前超过 1100 行，单文件同时承担冲突文件加载、左右内容对齐、hunk 选择、输出合成、三栏虚拟滚动同步、保存操作和完整 UI 渲染。这个文件已经成为 diff / merge-rebase 领域里最明显的维护瓶颈。

本次重构目标是在不改变用户可见行为和 IPC 契约的前提下，把复杂逻辑拆到可复用、可测试的纯函数与 composable 中，让 `ConflictView.vue` 回到负责组装页面和连接 store 的角色。

预期结果：

- 冲突对齐和输出合成逻辑从 Vue 组件中移出，便于单元测试覆盖。
- 三栏滚动同步和 hunk 导航从模板状态中解耦，降低后续 UI 调整风险。
- `ConflictView.vue` 明显瘦身，保留现有三栏布局、行级勾选、全选 ours/theirs、输出预览和保存行为。
- 不修改后端 IPC、`ConflictFile` 数据结构或合并/变基工作流。

## 进度总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 提取冲突对齐与输出合成纯函数 | 待办 |
| 2 | 为纯函数补单元测试 | 待办 |
| 3 | 提取选择状态、hunk 导航和滚动同步 composable | 待办 |
| 4 | 拆分轻量 UI 子组件并组装 `ConflictView.vue` | 待办 |
| 5 | 类型检查、单元测试和手动冲突解决验证 | 待办 |

## 子任务清单

- [ ] 创建 `src/lib/conflictMerge.ts`
  - [ ] 定义 `AlignRow`、`ConflictHunk`、输出映射等前端内部类型。
  - [ ] 提取当前 LCS 行级对齐逻辑，保持相邻 left-only / right-only 合并为 changed 的行为。
  - [ ] 提取根据选中行生成输出文本和行号映射的逻辑。
- [ ] 创建 `src/lib/conflictMerge.spec.ts`
  - [ ] 覆盖完全相同内容、单侧新增、双侧修改、多个 hunk、尾部空行处理。
  - [ ] 覆盖按行选择 ours/theirs 后的输出顺序。
- [ ] 创建 `src/composables/diff/useConflictSelection.ts`
  - [ ] 管理选中行集合、单行切换、按 hunk 切换、全选 ours/theirs、清空选择。
  - [ ] 保留 hunk master checkbox 的 all / some 状态。
- [ ] 创建 `src/composables/diff/useSyncedConflictPanes.ts`
  - [ ] 管理三栏 virtualizer 引用、滚动同步和 hunk 定位。
  - [ ] 保留当前避免递归滚动触发的同步策略。
- [ ] 视情况拆分 UI 子组件
  - [ ] `ConflictToolbar.vue`：文件标题、hunk 导航、全选按钮、保存按钮。
  - [ ] `ConflictPane.vue`：ours / theirs 单栏渲染。
  - [ ] `ConflictOutputPane.vue`：输出预览栏渲染。
- [ ] 重组 `ConflictView.vue`
  - [ ] 只保留文件加载、错误/加载/保存状态、顶层布局和子模块接线。
  - [ ] 保持当前 class 名或等价样式，避免视觉回归。
- [ ] 验证
  - [ ] `npx vue-tsc --noEmit`
  - [ ] `npm run test`
  - [ ] 手动制造 merge/rebase 冲突，验证打开冲突文件、按行选择、hunk 全选、三栏滚动、保存并标记已解决。

## 关键决策

1. **先抽纯逻辑，再拆 UI**：当前最大风险不在模板行数，而在对齐和输出合成逻辑藏在组件内部。先把这些逻辑提成纯函数并补测试，可以在后续拆组件时降低回归风险。
2. **不改变冲突解决模型**：继续保持按行选择 ours/theirs 并实时生成输出预览，不引入自由文本编辑。这个行为是 `docs/15-merge-rebase.md` 中的既定取舍。
3. **不改 IPC 契约**：本次只重构前端组织方式，不修改 `ConflictFile`、`loadConflictFile`、`saveResolvedConflict` 等后端契约，也不需要更新 `docs/11-ipc.md`。
4. **谨慎处理虚拟滚动**：三栏同步滚动属于交互热路径。提取 composable 时只移动状态和函数，不更换虚拟滚动库，不改变 row height、overscan、滚动定位语义。
5. **组件拆分以低耦合为准**：如果 `ConflictPane` 拆分导致 props / emits 过多或影响滚动同步可读性，优先保留渲染在主文件，先完成逻辑瘦身。

## 验证方式

1. 自动验证：
   - `npx vue-tsc --noEmit`
   - `npm run test`
2. 手动验证：
   - 在测试仓库制造同一文件的 merge 或 rebase 冲突。
   - 打开冲突文件，确认 ours / theirs / output 三栏内容和行号正常。
   - 测试单行选择、hunk 级选择、Use all ours、Use all theirs、Clear。
   - 滚动任意一栏，确认另外两栏同步且没有抖动。
   - 使用 hunk 上一个 / 下一个跳转，确认定位准确。
   - 保存后确认文件进入已解决状态，后续 continue 操作仍可执行。
