import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { applyAutoLocaleFromSystem, normalizeLocale, setLocale } from '@/i18n'

/**
 * 用户设置：主题、字体、字号、accent 覆盖。
 *
 * 设计要点：
 * - 单 key localStorage（JSON）持久化，同步读取以避免 FOUC
 * - 模块顶层 side-effect：import 触发一次同步 apply，早于 Vue 挂载
 * - watch(deep) 监听 store 变化 → 即时 apply 到 :root + debounced persist
 * - themeMode='auto' 时订阅 matchMedia('(prefers-color-scheme: dark)')
 */

// ── 类型 ──────────────────────────────────────────────────────────────
export type ThemeMode = 'auto' | 'light' | 'dark'
export type AccentKey = 'blue' | 'green' | 'red' | 'yellow' | 'orange'
export type AccentOverrides = Partial<Record<AccentKey, string>>

/**
 * 外部终端选项（仅 macOS 使用；其它平台保持自动探测逻辑）
 * - 预设项对应 macOS 下 `open -a <app>` 的 app 名
 * - `custom` 时使用 `externalTerminalCustom` 字段里的值
 */
export type ExternalTerminal = 'terminal' | 'iterm2' | 'warp' | 'ghostty' | 'custom'

/**
 * 提交图分叉 / 汇入样式：
 * - `rounded`（默认）：控制点拉到行内对角的圆润 Z，两端紧贴 lane 竖直延伸、中段近似水平
 * - `step`：orthogonal 直角布线 —— 竖直 → 圆角 → 水平 → 圆角 → 竖直（地铁 / 流程图风格）
 * - `angular`：控制点退化的折线，分叉处呈锐角
 */
export type GraphStyle = 'rounded' | 'step' | 'angular'

/**
 * 提交历史行分隔线样式：
 * - `solid`（默认）：实线
 * - `dashed`：虚线
 * - `dotted`：点线
 */
export type RowSeparatorStyle = 'solid' | 'dashed' | 'dotted'

/**
 * UI 语言：
 * - `auto`：跟随系统（启动时同步从 navigator.language / autoCache 猜测，挂载后异步调 plugin-os 校正）
 * - `zh-CN` / `en`：用户显式指定
 */
export type UiLanguage = 'auto' | 'zh-CN' | 'en'

/** 行分隔线透明度上限（0 = 无色，100 = 完全不透明） */
export const ROW_SEPARATOR_MAX = 100
/** 最高档对应的 alpha（100% = 完全不透明） */
export const ROW_SEPARATOR_ALPHA_PEAK = 1.0
/** 旧版（0..10 档位、peak=0.4）持久化值迁移到新尺度的缩放因子：old × 4 = new */
const ROW_SEPARATOR_LEGACY_SCALE = 4

/** 历史提交行高（px）下限 */
export const HISTORY_ROW_HEIGHT_MIN = 10
/** 历史提交行高（px）上限 */
export const HISTORY_ROW_HEIGHT_MAX = 30

/** 文件列表行高（px）下限 */
export const FILE_LIST_ROW_HEIGHT_MIN = 10
/** 文件列表行高（px）上限 */
export const FILE_LIST_ROW_HEIGHT_MAX = 30

export interface ExternalTerminalPreset {
  value: ExternalTerminal
  /** i18n 消息 key；消费方在 UI 侧用 t() 渲染 */
  labelKey: string
  /** macOS 下传给 `open -a` 的 app 名；custom 项留空 */
  appName: string
}

export const EXTERNAL_TERMINAL_PRESETS: ExternalTerminalPreset[] = [
  { value: 'terminal', labelKey: 'settings.externalTools.preset.terminal', appName: 'Terminal' },
  { value: 'iterm2', labelKey: 'settings.externalTools.preset.iterm2', appName: 'iTerm' },
  { value: 'warp', labelKey: 'settings.externalTools.preset.warp', appName: 'Warp' },
  { value: 'ghostty', labelKey: 'settings.externalTools.preset.ghostty', appName: 'Ghostty' },
  { value: 'custom', labelKey: 'settings.externalTools.preset.custom', appName: '' },
]

/**
 * 自动更新策略：
 * - `auto`: 启动时自动检查更新（默认）
 * - `manual`: 仅在“关于”页面点击手动检查
 */
export type UpdateStrategy = 'auto' | 'manual'

export interface SettingsData {
  themeMode: ThemeMode
  uiFontFamily: string      // '' = 默认栈
  uiFontSize: number        // px
  codeFontFamily: string    // '' = 默认栈
  codeFontSize: number      // px
  accentOverrides: AccentOverrides
  externalTerminal: ExternalTerminal
  externalTerminalCustom: string  // 当 externalTerminal === 'custom' 时使用的 app 名 / bundle id
  graphStyle: GraphStyle
  /** 提交历史行分隔线透明度百分比 0..ROW_SEPARATOR_MAX，直接作为 alpha（%） */
  rowSeparatorStrength: number
  rowSeparatorStyle: RowSeparatorStyle
  /** 提交历史每行高度（px），范围 HISTORY_ROW_HEIGHT_MIN..MAX */
  historyRowHeight: number
  /** 文件列表每行高度（px），范围 FILE_LIST_ROW_HEIGHT_MIN..MAX */
  fileListRowHeight: number
  /** UI 语言；默认 'auto' 跟随系统 */
  uiLanguage: UiLanguage
  /** 更新策略 */
  updateStrategy: UpdateStrategy
  /** 已跳过的更新版本号 */
  skippedVersion: string | null
}

export const DEFAULT_SETTINGS: SettingsData = {
  themeMode: 'auto',
  uiFontFamily: '',
  uiFontSize: 12,
  codeFontFamily: '',
  codeFontSize: 12,
  accentOverrides: {},
  externalTerminal: 'terminal',
  externalTerminalCustom: '',
  graphStyle: 'rounded',
  rowSeparatorStrength: 30,
  rowSeparatorStyle: 'solid',
  historyRowHeight: 20,
  fileListRowHeight: 18,
  uiLanguage: 'auto',
  updateStrategy: 'auto',
  skippedVersion: null,
}

/**
 * 根据当前设置解析出要传给后端 `open_terminal` 的 app 名。
 * 返回 null 表示保持后端默认（自动探测）。
 */
export function resolveExternalTerminalApp(data: Pick<SettingsData, 'externalTerminal' | 'externalTerminalCustom'>): string | null {
  if (data.externalTerminal === 'custom') {
    const name = data.externalTerminalCustom.trim()
    return name || null
  }
  const preset = EXTERNAL_TERMINAL_PRESETS.find(p => p.value === data.externalTerminal)
  return preset?.appName || null
}

// ── 预设字体（下拉候选） ──────────────────────────────────────────────
// 每项 labelKey 是 i18n key，消费方在 UI 用 t() 渲染；value 是完整 font-family fallback 串
export const UI_FONT_PRESETS: Array<{ labelKey: string; value: string }> = [
  { labelKey: 'settings.font.preset.default', value: '' },
  { labelKey: 'settings.font.preset.systemUi', value: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif" },
  { labelKey: 'settings.font.preset.sfPro', value: "'SF Pro Text', -apple-system, sans-serif" },
  { labelKey: 'settings.font.preset.inter', value: "'Inter', system-ui, sans-serif" },
  { labelKey: 'settings.font.preset.segoeUi', value: "'Segoe UI', system-ui, sans-serif" },
  { labelKey: 'settings.font.preset.sfMonoMono', value: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace" },
]

export const CODE_FONT_PRESETS: Array<{ labelKey: string; value: string }> = [
  { labelKey: 'settings.font.preset.default', value: '' },
  { labelKey: 'settings.font.preset.sfMono', value: "'SF Mono', Menlo, monospace" },
  { labelKey: 'settings.font.preset.menlo', value: "Menlo, 'SF Mono', monospace" },
  { labelKey: 'settings.font.preset.consolas', value: "Consolas, 'SF Mono', monospace" },
  { labelKey: 'settings.font.preset.firaCode', value: "'Fira Code', 'SF Mono', monospace" },
  { labelKey: 'settings.font.preset.jetbrainsMono', value: "'JetBrains Mono', 'SF Mono', monospace" },
  { labelKey: 'settings.font.preset.cascadiaCode', value: "'Cascadia Code', 'SF Mono', monospace" },
]

const STORAGE_KEY = 'gitui.settings.v1'
const MIN_FONT_SIZE = 10
const MAX_FONT_SIZE = 22

// ── 同步读取（启动即可用） ────────────────────────────────────────────
function loadSync(): SettingsData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS, accentOverrides: {} }
    const parsed = JSON.parse(raw)
    const merged: SettingsData = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      accentOverrides: { ...(parsed?.accentOverrides ?? {}) },
    }
    // 迁移：旧版 rowSeparatorStrength 是 0..10 档位（peak 0.4），新版是 0..100 直接
    // 代表 alpha 百分比。凡是持久化值 ≤ 10 的视为旧数据，× 4 换算保持视觉等价。
    if (
      typeof parsed?.rowSeparatorStrength === 'number'
      && parsed.rowSeparatorStrength <= 10
    ) {
      merged.rowSeparatorStrength = Math.round(parsed.rowSeparatorStrength * ROW_SEPARATOR_LEGACY_SCALE)
    }
    return merged
  } catch {
    return { ...DEFAULT_SETTINGS, accentOverrides: {} }
  }
}

function persist(data: SettingsData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // 忽略 quota / 隐私模式失败
  }
}

// ── 主题解析：auto 档根据系统偏好决定 light/dark ──────────────────────
function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'auto') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'dark'
  }
  return mode
}

// ── 同步 Windows 标题栏主题（setTheme 在非 Tauri 环境下静默失败） ────
async function syncWindowTheme(resolved: 'dark' | 'light') {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setTheme(resolved)
  } catch {
    // 非 Tauri 环境（浏览器开发模式）忽略
  }
}

// ── 把设置应用到 :root（CSS 变量 + data-theme 属性） ─────────────────
export function applySettingsToDom(data: SettingsData) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const resolved = resolveTheme(data.themeMode)
  root.setAttribute('data-theme', resolved)
  void syncWindowTheme(resolved)

  // 字体 / 字号：有自定义值则覆盖，否则移除让 main.css 的默认生效
  if (data.uiFontFamily) {
    root.style.setProperty('--ui-font-family', data.uiFontFamily)
  } else {
    root.style.removeProperty('--ui-font-family')
  }
  if (data.codeFontFamily) {
    root.style.setProperty('--code-font-family', data.codeFontFamily)
  } else {
    root.style.removeProperty('--code-font-family')
  }
  root.style.setProperty('--ui-font-size', `${data.uiFontSize}px`)
  root.style.setProperty('--code-font-size', `${data.codeFontSize}px`)

  // Accent 覆盖：有覆盖则 setProperty，否则移除让 main.css 的默认生效
  const keys: AccentKey[] = ['blue', 'green', 'red', 'yellow', 'orange']
  for (const k of keys) {
    const v = data.accentOverrides[k]
    if (v && /^#[0-9a-fA-F]{6}$/.test(v)) {
      root.style.setProperty(`--accent-${k}`, v)
    } else {
      root.style.removeProperty(`--accent-${k}`)
    }
  }

  // 行分隔线：alpha = strength / MAX * ALPHA_PEAK，主题相关的 rgb 由 main.css 处理
  const strength = clampSeparatorStrength(data.rowSeparatorStrength)
  const alpha = (strength / ROW_SEPARATOR_MAX) * ROW_SEPARATOR_ALPHA_PEAK
  root.style.setProperty('--row-separator-alpha', alpha.toFixed(3))
  root.style.setProperty('--row-separator-style', data.rowSeparatorStyle)

  // 历史提交行高：CSS 变量下发给 HistoryView / CommitGraphRow / WipRow 消费
  const rowH = clampHistoryRowHeight(data.historyRowHeight)
  root.style.setProperty('--history-row-height', `${rowH}px`)

  // 文件列表行高：CSS 变量下发给 FileChangeList / CommitInfoPanel 的文件 tab
  const fileRowH = clampFileListRowHeight(data.fileListRowHeight)
  root.style.setProperty('--file-list-row-height', `${fileRowH}px`)
}

// ── 模块顶层 side-effect：import 就同步 apply（防 FOUC） ──────────────
const __initialData = loadSync()
applySettingsToDom(__initialData)

// matchMedia 订阅（仅 auto 档启用）
let __mql: MediaQueryList | null = null
let __mqlListener: ((e: MediaQueryListEvent) => void) | null = null
function bindAutoWatch(getCurrent: () => SettingsData) {
  if (typeof window === 'undefined' || !window.matchMedia) return
  if (__mql && __mqlListener) {
    __mql.removeEventListener('change', __mqlListener)
    __mql = null
    __mqlListener = null
  }
  __mql = window.matchMedia('(prefers-color-scheme: dark)')
  __mqlListener = () => {
    if (getCurrent().themeMode === 'auto') {
      applySettingsToDom(getCurrent())
    }
  }
  __mql.addEventListener('change', __mqlListener)
}

// ── Store ─────────────────────────────────────────────────────────────
export const useSettingsStore = defineStore('settings', () => {
  const themeMode = ref<ThemeMode>(__initialData.themeMode)
  const uiFontFamily = ref<string>(__initialData.uiFontFamily)
  const uiFontSize = ref<number>(clampSize(__initialData.uiFontSize))
  const codeFontFamily = ref<string>(__initialData.codeFontFamily)
  const codeFontSize = ref<number>(clampSize(__initialData.codeFontSize))
  const accentOverrides = ref<AccentOverrides>({ ...__initialData.accentOverrides })
  const externalTerminal = ref<ExternalTerminal>(__initialData.externalTerminal)
  const externalTerminalCustom = ref<string>(__initialData.externalTerminalCustom)
  const graphStyle = ref<GraphStyle>(__initialData.graphStyle)
  const rowSeparatorStrength = ref<number>(clampSeparatorStrength(__initialData.rowSeparatorStrength))
  const rowSeparatorStyle = ref<RowSeparatorStyle>(__initialData.rowSeparatorStyle)
  const historyRowHeight = ref<number>(clampHistoryRowHeight(__initialData.historyRowHeight))
  const fileListRowHeight = ref<number>(clampFileListRowHeight(__initialData.fileListRowHeight))
  const uiLanguage = ref<UiLanguage>(normalizeUiLanguage(__initialData.uiLanguage))
  const updateStrategy = ref<UpdateStrategy>(__initialData.updateStrategy ?? 'auto')
  const skippedVersion = ref<string | null>(__initialData.skippedVersion ?? null)

  function snapshot(): SettingsData {
    return {
      themeMode: themeMode.value,
      uiFontFamily: uiFontFamily.value,
      uiFontSize: uiFontSize.value,
      codeFontFamily: codeFontFamily.value,
      codeFontSize: codeFontSize.value,
      accentOverrides: { ...accentOverrides.value },
      externalTerminal: externalTerminal.value,
      externalTerminalCustom: externalTerminalCustom.value,
      graphStyle: graphStyle.value,
      rowSeparatorStrength: rowSeparatorStrength.value,
      rowSeparatorStyle: rowSeparatorStyle.value,
      historyRowHeight: historyRowHeight.value,
      fileListRowHeight: fileListRowHeight.value,
      uiLanguage: uiLanguage.value,
      updateStrategy: updateStrategy.value,
      skippedVersion: skippedVersion.value,
    }
  }

  // ── debounced persist ───────────────────────────────────────────────
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persist(snapshot())
      persistTimer = null
    }, 300)
  }

  // ── deep watch：实时 apply + debounce 持久化 ─────────────────────────
  watch(
    [
      themeMode,
      uiFontFamily,
      uiFontSize,
      codeFontFamily,
      codeFontSize,
      accentOverrides,
      externalTerminal,
      externalTerminalCustom,
      graphStyle,
      rowSeparatorStrength,
      rowSeparatorStyle,
      historyRowHeight,
      fileListRowHeight,
      uiLanguage,
      updateStrategy,
      skippedVersion,
    ],
    () => {
      applySettingsToDom(snapshot())
      schedulePersist()
    },
    { deep: true },
  )

  // 语言：store 实例化时立即 apply 一次，之后每次变更也 apply。i18n 实例创建时
  // 已用 detectInitialLocale 同步猜出一个 locale；这里负责在 auto 档下异步用
  // plugin-os 做精确校正，在用户手动切换时立即切。
  watch(
    uiLanguage,
    (value) => { void applyLocaleFromSettings(value) },
    { immediate: true },
  )

  // auto 档的系统主题订阅
  bindAutoWatch(snapshot)

  // ── actions ─────────────────────────────────────────────────────────
  function setAccentOverride(key: AccentKey, hex: string | undefined) {
    if (!hex) {
      const next = { ...accentOverrides.value }
      delete next[key]
      accentOverrides.value = next
    } else {
      accentOverrides.value = { ...accentOverrides.value, [key]: hex }
    }
  }

  function resetAppearance() {
    themeMode.value = DEFAULT_SETTINGS.themeMode
    accentOverrides.value = {}
    graphStyle.value = DEFAULT_SETTINGS.graphStyle
    rowSeparatorStrength.value = DEFAULT_SETTINGS.rowSeparatorStrength
    rowSeparatorStyle.value = DEFAULT_SETTINGS.rowSeparatorStyle
    historyRowHeight.value = DEFAULT_SETTINGS.historyRowHeight
    fileListRowHeight.value = DEFAULT_SETTINGS.fileListRowHeight
  }

  function resetUiFont() {
    uiFontFamily.value = DEFAULT_SETTINGS.uiFontFamily
    uiFontSize.value = DEFAULT_SETTINGS.uiFontSize
  }

  function resetCodeFont() {
    codeFontFamily.value = DEFAULT_SETTINGS.codeFontFamily
    codeFontSize.value = DEFAULT_SETTINGS.codeFontSize
  }

  function resetFont() {
    resetUiFont()
    resetCodeFont()
  }

  function resetExternalTools() {
    externalTerminal.value = DEFAULT_SETTINGS.externalTerminal
    externalTerminalCustom.value = DEFAULT_SETTINGS.externalTerminalCustom
  }

  function resetAll() {
    resetAppearance()
    resetFont()
    resetExternalTools()
  }

  // ── 判断某组是否处于非默认状态（供 UI 禁用恢复按钮） ───────────
  const uiFontIsDefault = computed(() =>
    uiFontFamily.value === DEFAULT_SETTINGS.uiFontFamily
    && uiFontSize.value === DEFAULT_SETTINGS.uiFontSize,
  )
  const codeFontIsDefault = computed(() =>
    codeFontFamily.value === DEFAULT_SETTINGS.codeFontFamily
    && codeFontSize.value === DEFAULT_SETTINGS.codeFontSize,
  )

  return {
    themeMode,
    uiFontFamily,
    uiFontSize,
    codeFontFamily,
    codeFontSize,
    accentOverrides,
    externalTerminal,
    externalTerminalCustom,
    graphStyle,
    rowSeparatorStrength,
    rowSeparatorStyle,
    historyRowHeight,
    fileListRowHeight,
    uiLanguage,
    updateStrategy,
    skippedVersion,
    uiFontIsDefault,
    codeFontIsDefault,
    setAccentOverride,
    resetAppearance,
    resetUiFont,
    resetCodeFont,
    resetFont,
    resetExternalTools,
    resetAll,
  }
})

function clampSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.uiFontSize
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(n)))
}

export function clampSeparatorStrength(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.rowSeparatorStrength
  return Math.max(0, Math.min(ROW_SEPARATOR_MAX, Math.round(n)))
}

export function clampHistoryRowHeight(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.historyRowHeight
  return Math.max(HISTORY_ROW_HEIGHT_MIN, Math.min(HISTORY_ROW_HEIGHT_MAX, Math.round(n)))
}

export function clampFileListRowHeight(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.fileListRowHeight
  return Math.max(FILE_LIST_ROW_HEIGHT_MIN, Math.min(FILE_LIST_ROW_HEIGHT_MAX, Math.round(n)))
}

function normalizeUiLanguage(v: unknown): UiLanguage {
  return v === 'zh-CN' || v === 'en' || v === 'auto' ? v : 'auto'
}

/**
 * 根据 uiLanguage 设置调整 i18n 的当前 locale：
 * - `zh-CN` / `en`：同步切换
 * - `auto`：先用 navigator.language 同步顶上（避免闪烁），再异步调 plugin-os 做精确校正
 */
async function applyLocaleFromSettings(value: UiLanguage) {
  if (value === 'zh-CN' || value === 'en') {
    setLocale(value)
    return
  }
  // auto：i18n 实例初始化时 detectInitialLocale 已给过同步猜测；用户从 zh-CN/en
  // 切回 auto 时也需要重新猜一下，再由 plugin-os 校正。
  if (typeof navigator !== 'undefined' && navigator.language) {
    setLocale(normalizeLocale(navigator.language))
  }
  await applyAutoLocaleFromSystem()
}

export { MIN_FONT_SIZE, MAX_FONT_SIZE }
