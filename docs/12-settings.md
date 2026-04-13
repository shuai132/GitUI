# 12. 设置

用户可调整的外观偏好：主题（跟随系统 / 浅色 / 深色）、UI 与代码字体字号、五个 accent 强调色覆盖。纯前端功能，不涉及 IPC。

## 涉及模块

- `stores/settings.ts`：Pinia store + 持久化 + 应用到 DOM
- `components/settings/SettingsModal.vue`：模态壳，左侧 tab 导航 + 右侧内容
  - `AppearanceSection.vue`：主题三档 + accent 覆盖
  - `FontSection.vue`：UI / 代码 两组 `font-family` + `font-size`
  - `AdvancedSection.vue`：语言 / 快捷键 / Git 偏好 —— 占位灰显，未实现
- `components/layout/AppToolbar.vue`：右上角齿轮按钮触发 Modal
- `assets/main.css`：主题变量与 `[data-theme="light"]` 覆盖，四个字体相关变量

## 入口与交互

右上角工具栏齿轮按钮打开 `SettingsModal`。Modal 宽 720px，无"保存"按钮——任何字段变更**实时生效、实时持久化**。footer 有「恢复外观/字体默认」按钮，按当前 tab 作用域重置；高级 tab 下禁用。

## 数据模型

`SettingsData`（见 `stores/settings.ts`）字段：

- `themeMode: 'auto' | 'light' | 'dark'`
- `uiFontFamily: string`（空串 = 使用 CSS 栈默认）
- `uiFontSize: number`（px）
- `codeFontFamily: string`
- `codeFontSize: number`（px）
- `accentOverrides: Partial<Record<'blue'|'green'|'red'|'yellow'|'orange', string>>`（HEX）

字体的预设下拉候选见 `UI_FONT_PRESETS` / `CODE_FONT_PRESETS`（同文件），每项 `value` 是完整 `font-family` fallback 串。

## 主题切换机制

主题通过根元素的 `data-theme` 属性 + CSS 变量实现：

- `main.css` 的 `:root` 定义**深色默认**（保持现有深蓝黑配色，不破坏存量组件）
- `:root[data-theme="light"]` 覆盖浅色值（GitHub Primer Light 风格：冷灰白 + 工程化配色）
- `themeMode === 'auto'` 时 store 订阅 `matchMedia('(prefers-color-scheme: dark)')`，系统切换即时跟随
- `themeMode === 'light' | 'dark'` 时移除 matchMedia 监听，用户选择生效

Accent 覆盖：store 对每个 accent 键调用 `setProperty('--accent-<key>', hex)` 直接在 `:root` 上覆写；清空则 `removeProperty` 回退到主题默认。

## 字体应用范围

引入四个 CSS 变量（见 `main.css`）：`--ui-font-family` / `--ui-font-size` / `--code-font-family` / `--code-font-size`。

- UI 字体/字号只改了 `html, body, #app` 根元素；**子组件里的硬编码 px 保持不变**。理由：这些硬编码是针对工具栏/侧边栏的"紧凑次级字号"，整体缩放会破坏布局节奏。实际效果覆盖通过继承生效的主要正文区域。
- 代码字体**批量穿透**到 diff 容器（`InlineDiff` / `SideBySideDiff` / `DiffView`）、commit hash 展示（`CommitList` / `CommitInfoPanel` / `HistoryView`）、sidebar stash index、error / reflog 对话框等使用代码字体的位置（搜索 `code-font-family` 得到完整清单）。代码字号只在三个 diff 容器生效，hash 类小字号保持原有 10-11px 不跟字号联动。

## 持久化与启动

- 单 key `gitui.settings.v1` + localStorage（JSON）。选 localStorage 而非 `@tauri-apps/plugin-store`：**同步读取**，便于在 Vue 挂载前即完成 CSS 变量写入，避免 FOUC
- `main.ts` 在 `app.mount('#app')` 之前 `import './stores/settings'`，触发模块顶层 side-effect：同步 `loadSync()` + `applySettingsToDom()`。此后 store 的 `watch(deep)` 统一处理运行时变更：即时 `applySettingsToDom` + debounce 300ms 落盘

## 不做的事

- 不做多配色家族下拉（Mocha / Frappé 等）。当前只深浅两档基调；如后续要扩展，加一层 `colorScheme` 字段即可，不影响 `themeMode` 语义
- UI 字号**不**批量替换子组件硬编码 px。如要做整屏 rem 化，属于另一次重构
- 高级 tab 的三项（语言 / 快捷键 / Git 偏好）仅占位，不提供真实开关
- 不支持设置项的导入导出、跨设备同步
