import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

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

export interface SettingsData {
  themeMode: ThemeMode
  uiFontFamily: string      // '' = 默认栈
  uiFontSize: number        // px
  codeFontFamily: string    // '' = 默认栈
  codeFontSize: number      // px
  accentOverrides: AccentOverrides
}

export const DEFAULT_SETTINGS: SettingsData = {
  themeMode: 'auto',
  uiFontFamily: '',
  uiFontSize: 13,
  codeFontFamily: '',
  codeFontSize: 12,
  accentOverrides: {},
}

// ── 预设字体（下拉候选） ──────────────────────────────────────────────
// 每项 label 给用户看，value 是完整 font-family fallback 串
export const UI_FONT_PRESETS: Array<{ label: string; value: string }> = [
  { label: '默认', value: '' },
  { label: '系统界面', value: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif" },
  { label: 'SF Pro', value: "'SF Pro Text', -apple-system, sans-serif" },
  { label: 'Inter', value: "'Inter', system-ui, sans-serif" },
  { label: 'Segoe UI', value: "'Segoe UI', system-ui, sans-serif" },
  { label: 'SF Mono（等宽）', value: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace" },
]

export const CODE_FONT_PRESETS: Array<{ label: string; value: string }> = [
  { label: '默认', value: '' },
  { label: 'SF Mono', value: "'SF Mono', Menlo, monospace" },
  { label: 'Menlo', value: "Menlo, 'SF Mono', monospace" },
  { label: 'Consolas', value: "Consolas, 'SF Mono', monospace" },
  { label: 'Fira Code', value: "'Fira Code', 'SF Mono', monospace" },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', 'SF Mono', monospace" },
  { label: 'Cascadia Code', value: "'Cascadia Code', 'SF Mono', monospace" },
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
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      accentOverrides: { ...(parsed?.accentOverrides ?? {}) },
    }
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

// ── 把设置应用到 :root（CSS 变量 + data-theme 属性） ─────────────────
export function applySettingsToDom(data: SettingsData) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const resolved = resolveTheme(data.themeMode)
  root.setAttribute('data-theme', resolved)

  // 字体 / 字号
  root.style.setProperty('--ui-font-family', data.uiFontFamily || '')
  root.style.setProperty('--code-font-family', data.codeFontFamily || '')
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

  function snapshot(): SettingsData {
    return {
      themeMode: themeMode.value,
      uiFontFamily: uiFontFamily.value,
      uiFontSize: uiFontSize.value,
      codeFontFamily: codeFontFamily.value,
      codeFontSize: codeFontSize.value,
      accentOverrides: { ...accentOverrides.value },
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
    [themeMode, uiFontFamily, uiFontSize, codeFontFamily, codeFontSize, accentOverrides],
    () => {
      applySettingsToDom(snapshot())
      schedulePersist()
    },
    { deep: true },
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

  function resetAll() {
    resetAppearance()
    resetFont()
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
    uiFontIsDefault,
    codeFontIsDefault,
    setAccentOverride,
    resetAppearance,
    resetUiFont,
    resetCodeFont,
    resetFont,
    resetAll,
  }
})

function clampSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.uiFontSize
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(n)))
}

export { MIN_FONT_SIZE, MAX_FONT_SIZE }
