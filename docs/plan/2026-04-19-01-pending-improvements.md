# 2026-04-19-01 待完善功能批量实现

## Context

经过全面代码审查，发现以下六类待完善项：

1. **Dead code**：`GitError::Credentials`、`_path_to_string`、`is_reflog_tip` 字段计算但前端不消费
2. **onError 事件接口孤立**：`useGitEvents.onError` 定义但从未被调用，后端也未 emit `repo://error`
3. **Word-level diff 高亮**：`docs/06-diff-viewer.md` 明确列为未完成行动项
4. **Git 偏好配置 UI**：auto-fetch 间隔硬编码 5 分钟，设置面板只有占位行
5. **Pull 完整 merge 支持**：`mode=="ff"` 且非快进时直接报错，应创建 merge commit
6. **快捷键自定义**：设置面板占位，功能未开发

预期结果：所有占位/孤立/报错的地方都有真正可用的实现。

## 进度总览

| 阶段 | 内容 | 状态 |
|------|------|------|
| P1 | Dead code 清理 | 待开始 |
| P2 | onError 事件接口落地 | 待开始 |
| P3 | Word-level diff 高亮 | 待开始 |
| P4 | Git 偏好配置 UI | 待开始 |
| P5 | Pull 完整 merge 支持 | 待开始 |
| P6 | 快捷键自定义 | 待开始 |
| P7 | 文档更新 | 待开始 |

## 子任务清单

### P1 Dead code 清理
- [ ] 删除 `src-tauri/src/git/error.rs` 中 `#[allow(dead_code)] Credentials(String)` 变体
- [ ] 删除 `src-tauri/src/git/rebase.rs` 中 `#[allow(dead_code)] _path_to_string` 函数
- [ ] 将 `is_reflog_tip` 字段在前端 commit 行 UI 中消费（hover 提示或小角标）

### P2 onError 事件接口落地
- [ ] `auto_fetch.rs`：fetch 失败时 emit `repo://error`
- [ ] `watcher.rs`：监控错误时 emit `repo://error`（可选）
- [ ] `App.vue`：调用 `onError` handler，将 `msg` 以 toast 形式展示
- [ ] 前端 `errorMap.ts` 处理 `repo://error` 消息（或直接透传）

### P3 Word-level diff 高亮
- [ ] 新建 `src/lib/wordDiff.ts`：实现 Myers/LCS 字符级 diff，输出 `{ type: 'eq'|'del'|'add', text: string }[]`
- [ ] `SideBySideDiff.vue`：对 del/add 配对行调用 wordDiff，以 `<span class="word-del/add">` 标注差异片段
- [ ] `InlineDiff.vue`：对连续 del+add 配对行（一删一增）做 wordDiff 内联标注
- [ ] 添加 CSS 变量 `--diff-word-del-bg` / `--diff-word-add-bg`
- [ ] 语法高亮开启时 word-level 高亮依然生效（两者叠加或互斥，选互斥保持简单）

### P4 Git 偏好配置 UI
- [ ] 新建 `src/stores/gitPrefs.ts`：持久化 `autoFetchInterval`（单位秒，0=禁用）
- [ ] `src-tauri/src/commands/system.rs`：新增 `set_auto_fetch_interval(seconds: u64)` 命令
- [ ] `AutoFetchService`：支持运行时更改间隔（`update_interval` 方法，重启内部 timer）
- [ ] `src/composables/useGitCommands.ts`：添加 `setAutoFetchInterval` 封装
- [ ] `src/components/settings/AdvancedSection.vue`：替换 gitPrefs 占位行，改为真实的间隔选择器（0/1/5/10/30 分钟下拉）
- [ ] 设置改变时调用 IPC 通知后端

### P5 Pull 完整 merge 支持
- [ ] `src-tauri/src/git/engine.rs`：`mode=="ff"` 且非快进时执行 merge commit 创建
  - `repo.merge(&[&fetch_commit], None, None)` 触发合并
  - 若有冲突 → 返回 `Err(OperationFailed("merge conflict"))` 让前端提示
  - 若无冲突 → 生成 merge commit（读 signature、parents=[HEAD, FETCH_HEAD]、写 tree）、清理 MERGE_HEAD
- [ ] `errorMap.ts`：添加 merge conflict 关键字映射
- [ ] 更新 `docs/08-remote.md`：删除 "Merge required - not yet supported" 的说明

### P6 快捷键自定义
- [ ] 新建 `src/stores/shortcuts.ts`：定义 ~10 个 action、默认绑定、localStorage 持久化
- [ ] 新建 `src/composables/useShortcuts.ts`：全局 keydown handler，根据 store 派发 action
- [ ] `App.vue`：挂载 `useShortcuts`
- [ ] `src/components/settings/ShortcutsSection.vue`：显示所有绑定，点击可录入新快捷键
- [ ] `AdvancedSection.vue`：shortcuts 占位行替换为真实 UI（或新增 tab）
- [ ] 初始 actions：`refresh`、`openSettings`、`toggleTerminal`、`commit`、`fetchAll`、`prevCommit`、`nextCommit`

### P7 文档更新
- [ ] `docs/06-diff-viewer.md`：勾选 word-level 高亮行动项，补充实现说明
- [ ] `docs/08-remote.md`：更新 Pull 实现说明（支持 merge commit）、删除 "未来改进" 中已实现的项
- [ ] `docs/11-ipc.md`：新增 `set_auto_fetch_interval` 命令
- [ ] `src-tauri/src/git/types.rs`：确认 `is_reflog_tip` 字段文档更新

## 关键决策

### Word-level diff 算法
选用 Myers LCS 在字符级运行（单行 < 1000 字符时无性能问题）。语法高亮开启时**禁用** word-level（`v-html` 和 span 标注不能叠加，选择最简实现）。

### Pull merge 冲突处理
`mode=="ff"` 时，若 merge 分析为 `is_normal`：先尝试 auto-merge，无冲突则直接创建 merge commit；有冲突则清理中间状态并报错，让用户去终端处理。不实现交互式冲突解决（那是 ConflictView 的职责，且 ConflictView 当前针对手动解决）。

### auto-fetch 间隔
选项：0（禁用）/ 60s / 300s（默认）/ 600s / 1800s。后端 `AutoFetchService` 收到新间隔后：cancel 现有 task，以新间隔重新 spawn。

### 快捷键作用域
全局 handler 只处理非 input/textarea 焦点下的快捷键，避免与表单输入冲突。

## 验证方式

1. `cargo check`：Rust 端无编译错误
2. `npx vue-tsc --noEmit`：前端无 TS 类型错误
3. `npm run build`：完整构建通过
4. 手动验证 word-level diff：打开任意有改动的文件，切到 side-by-side，能看到行内高亮片段
5. 手动验证 merge pull：制造分叉分支，点 pull（ff 模式），应创建 merge commit
6. 手动验证 auto-fetch 设置：改为 1 分钟，等待 1 分钟后检查 remote 刷新
7. 手动验证快捷键：在设置里改绑定，验证新绑定生效
