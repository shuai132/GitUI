import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import en from './locales/en'

export type UiLocale = 'zh-CN' | 'en'
export const SUPPORTED_LOCALES: UiLocale[] = ['zh-CN', 'en']

// 「auto」档位上次由系统 locale 异步解析出的结果缓存，用于下次冷启动同步命中，
// 避免英文系统首次启动先显示中文再切换。
const AUTO_CACHE_KEY = 'gitui.i18n.autoCache'
const SETTINGS_KEY = 'gitui.settings.v1'

/** 把任意 locale 字符串归一到目前支持的两档。zh-* 全归简中，其他全归英。 */
export function normalizeLocale(raw: string | null | undefined): UiLocale {
  if (!raw) return 'zh-CN'
  return raw.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

/**
 * 同步检测初始 locale。优先级：
 *   1. settings.uiLanguage === 'zh-CN' | 'en' → 直接用
 *   2. settings.uiLanguage === 'auto' 或缺失 → autoCache
 *   3. navigator.language normalize
 *   4. 兜底 'zh-CN'（项目原生中文）
 * plugin-os 的异步检测由挂载后的 applyAutoLocaleFromSystem 负责，不阻塞启动。
 */
export function detectInitialLocale(): UiLocale {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const ui = parsed?.uiLanguage
      if (ui === 'zh-CN' || ui === 'en') return ui
    }
    const cached = localStorage.getItem(AUTO_CACHE_KEY)
    if (cached === 'zh-CN' || cached === 'en') return cached
  } catch {
    // localStorage 不可用或解析失败，继续走下一步
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return normalizeLocale(navigator.language)
  }
  return 'zh-CN'
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: detectInitialLocale(),
  fallbackLocale: 'en',
  messages: {
    'zh-CN': zhCN,
    en,
  },
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
})

/** 手动设置 locale（来自 settings store 的 watch）。 */
export function setLocale(value: UiLocale) {
  if (i18n.global.locale.value !== value) {
    i18n.global.locale.value = value
  }
}

/**
 * 在 auto 档位下异步读系统 locale 并校正。挂载后由 settings store 在 uiLanguage
 * === 'auto' 时调用。结果写入 autoCache 供下次冷启动同步命中。
 */
export async function applyAutoLocaleFromSystem(): Promise<UiLocale> {
  try {
    const mod = await import('@tauri-apps/plugin-os')
    const raw = await mod.locale()
    const resolved = normalizeLocale(raw)
    setLocale(resolved)
    try {
      localStorage.setItem(AUTO_CACHE_KEY, resolved)
    } catch {
      // 忽略 quota / 隐私模式失败
    }
    return resolved
  } catch {
    return i18n.global.locale.value as UiLocale
  }
}

/** 给非组件上下文（store / util）使用的 t()。 */
export const t = i18n.global.t
