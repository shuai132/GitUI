# 冲突 Toast 展示为"警告"而非"错误" + 修复 errorMap JSON 退化

## Context

当前合并 / rebase / cherry-pick / revert 出现冲突时，toolbar toast 显示为红色 ✕ "错误"，且正文是序列化后的原始 JSON（如 `{"kind":"OperationFailed","message":"Merge 出现冲突，请解决后继续"}`）。两个叠加问题：

1. **Toast 语义不对**：冲突是"等待用户介入的中间状态"，不是 failure——libgit2 已经把 index/工作区留在可继续/可 abort 的状态，`MERGE_HEAD`/`REBASE` 存在、`OngoingOpBanner` 会显示后续入口。UI 层用红色错误图标会误导用户以为操作彻底失败需要回滚。

2. **errorMap 从没识别出 kind**：`src-tauri/src/git/error.rs` 上的 `GitError` 用 `#[serde(tag = "kind", content = "message")]` 序列化为 **两键** 对象 `{kind, message}`；但 `src/lib/errorMap.ts::extractKindAndMessage`（第 37–46 行）判定的是 `keys.length === 1` 的旧单键 adjacent-tag 形状。结果 `kind` 永远拿不到；message 退化成 `JSON.stringify(raw)`，随后英文 pattern 又没匹配中文 `"Merge 出现冲突"` / `"Rebase 出现冲突"` / `"Cherry-pick 出现冲突"`，最终落到 `errors.generic.unknown = '{detail}'`，把 JSON 原样塞进 toast。此 bug 影响**所有**后端自定义中文消息的错误，不仅冲突场景。

目标：

- Toast 新增 `warning` 变体（⚠️ + `--accent-orange`），冲突类走警告
- 修好 `extractKindAndMessage` 的两键形状解析
- 补 Chinese pattern 识别 merge / rebase / cherry-pick 冲突消息
- 清理 i18n 中"请在终端手动解决"之类的过时文案（冲突已由内置 UI 处理）

纯前端改动，不动 Rust 后端与 IPC 契约。

---

## 进度总览

| PR | 范围 | 状态 | 依赖 |
|----|------|------|------|
| PR 1 | errorMap 解析修复 + `level` 字段 + 冲突 pattern + errorsStore 透传 + toast warning 变体 + i18n 文案更新 | 已完成 | — |

单 commit 完成；无跨 PR 依赖。

---

## 一、`src/lib/errorMap.ts`

- [x] 修 `extractKindAndMessage`：识别 `{ kind: string, message: string }` 两键形状（当前 Rust `#[serde(tag = "kind", content = "message")]` 的产物），优先于 `JSON.stringify` 兜底。旧单键形状兼容保留（防止未来换回 adjacent tag 时回归）。
- [x] `FriendlyError` 新增 `level?: 'error' | 'warning'`，未设置默认为 `'error'`（在 errorsStore 侧做 fallback）。
- [x] 在 `PATTERNS` 里把冲突类规则收敛为"**既匹配现有英文，也匹配中文**"，并标 `level: 'warning'`：
  - Rebase 冲突：`/Rebase conflict|Rebase 出现冲突/i` → `errors.rebase.conflict` + warning
  - Cherry-pick / Revert 冲突：现有规则基础上标 warning（消息里含 `Cherry-pick 出现冲突 / Revert 出现冲突`）
  - 通用 merge 冲突：现有 `/conflict|needs merge/i` + 追加 `/Merge 出现冲突|仍有未解决的冲突/` → `errors.merge.conflict` + warning
- [x] `mapGitError` 返回的 `FriendlyError` 在命中规则时带上 `level`，其余走默认 error。

**关键点**：level 由 `mapGitError` 在 i18n key 选型时同点推导——不引入"level 白名单 map"这种重复事实来源。冲突类消息本身就是通过 key `errors.*.conflict` 表达的，和 warning 语义 1:1 对齐。

## 二、`src/stores/errors.ts`

- [x] `ErrorEntry` 新增 `level: 'error' | 'warning'`。
- [x] `push()` 里从 `mapGitError` 的返回值读 `level`，默认 `'error'`，写入 entry 并 unshift 到 `entries`。
- [x] `latestId` 语义不变，toolbar 继续 watch。

## 三、`src/components/layout/AppToolbar.vue`

- [x] `toast` ref 类型从 `{ type: 'success' | 'error', ... }` 扩成 `{ type: 'success' | 'error' | 'warning', ... }`。
- [x] errorsStore watch：依据 `entry.level` 选 `showToast('warning' | 'error', ...)`；文案拼接（`toolbar.opFailed` vs 其它）暂保持一致——冲突也是"某操作产生了冲突"，沿用 `opFailed` 模板即可，无需新 key。
- [x] 模板里 `v-if="toast.type === 'success'"` 分支不动；error 分支 → 改成 `v-else-if` + 再加 `warning` 分支：
  - 图标：⚠️（三角形 + 感叹号，lucide-style SVG）
  - 颜色：`--accent-orange`（`main.css` 已定义）
- [x] `<style scoped>` 追加 `.toast--warning` 三个规则（accent 条 / 图标圈 / progress 条），复用现有 error 块结构。

## 四、i18n 文案清理

`docs/15-merge-rebase.md` 明确冲突已由 `ThreeWayMergeEditor` + `WipPanel` 冲突分组在 **应用内** 处理，但 i18n 文案仍写"请在终端手动解决"。同步改：

- [x] `src/i18n/locales/zh-CN.ts`
  - `errors.rebase.conflict`：`'Rebase 出现冲突，请在终端手动解决'` → `'Rebase 出现冲突，请解决后继续'`
  - `errors.merge.conflict`：`'发生冲突，请在工作区手动解决后再提交'` → `'发生冲突，请在工作区解决后继续'`
  - `errors.cherrypick.conflict`：`'{type} 出现冲突，请在工作区手动解决'` → `'{type} 出现冲突，请解决后继续'`
- [x] `src/i18n/locales/en.ts`：同步 key 文案去掉 "in the terminal" 措辞。

文档本身（`docs/15-merge-rebase.md`）无改动——它描述的是行为，文案不在其契约范围。

---

## 关键决策

1. **不动 Rust 后端**：保留 `GitError::OperationFailed` 作为冲突返回通道。前端 `mergeRebase` store 的 `startMerge/startRebase` 已经在 `finally` 里无条件 `refreshAfterHeadChange()`，`OngoingOpBanner` 会依据 `repoState` 正确引导用户——即把"错误"转成"中间状态"的是前端。
2. **level 在前端推导，而不是后端字段**：后端加 `level` 字段会污染 IPC 契约，且冲突并非唯一"非致命"类别（未来可能还有 "working tree dirty"），集中在 `mapGitError` 规则里维护更灵活。
3. **保留 silent opts**：`useGitCommands.call()` 的 `{ silent: true }` 分支依然绕过 errorsStore，不受本次影响。
4. **toast 仍然单条可见**：不实现堆叠——冲突一次只会触发一条 warning，沿用现有 3s 自动消失 + 手动点"最近错误"里回看。`ErrorHistoryDialog` 列表里也应反映 level（图标颜色），本次暂不做以免扩散。

## 验证方式

- [ ] 本地 `npm run tauri dev` 启动，在一个已知会冲突的仓库执行 Merge（非 FF）：toast 应为橙色 ⚠️ + "发生冲突，请在工作区解决后继续"（中文 locale），不再是 JSON。
- [ ] 执行 Rebase 交互并构造冲突：同样走 warning。
- [ ] Cherry-pick 冲突：warning，文案带 "cherry-pick 出现冲突"。
- [ ] 构造一个非冲突错误（如推到不存在的 remote）：toast 仍为红色 ✕，且文案是 i18n 过的友好消息（不是 JSON）——回归测试 extractKindAndMessage 修复对所有错误生效。
- [ ] 切英文 locale，重复上述 4 条，文案是英文。
- [x] `npx vue-tsc --noEmit` 通过。
- [x] `cd src-tauri && cargo check` 通过。
