/**
 * shortcutsStore.ts — 可配置键盘快捷键
 *
 * 默认绑定根据平台自动选择：
 *   - macOS：主修饰键用 ⌘（meta）
 *   - 其他平台：主修饰键用 Ctrl
 *
 * 存储版本号（STORAGE_VERSION）升级后会清除旧绑定、使用新默认值。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ShortcutActionId =
  | 'refresh'
  | 'openSettings'
  | 'toggleTerminal'
  | 'fetchAll'
  | 'search'
  | 'prevCommit'
  | 'nextCommit'
  | 'commit'
  | 'toggleDiffLayout'

export interface KeyBinding {
  key: string         // e.g. 'r', 'F5', ','
  ctrl?: boolean
  meta?: boolean      // Cmd on macOS
  shift?: boolean
  alt?: boolean
}

export interface ShortcutDef {
  id: ShortcutActionId
  /** i18n key for display name */
  labelKey: string
  /** Default binding */
  defaultBinding: KeyBinding | null
}

// 检测平台（在模块加载时计算一次，避免每次调用都读 navigator）
const IS_MAC =
  typeof navigator !== 'undefined' &&
  (navigator.platform.toLowerCase().startsWith('mac') ||
    /macintosh|mac os x/i.test(navigator.userAgent))

/**
 * 生成跨平台默认绑定：macOS 用 meta（⌘），其他平台用 ctrl。
 * 若同时传入 shift / alt，也会合并进去。
 */
function mkBinding(key: string, extra?: Omit<KeyBinding, 'key' | 'ctrl' | 'meta'>): KeyBinding {
  return IS_MAC ? { key, meta: true, ...extra } : { key, ctrl: true, ...extra }
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'refresh',          labelKey: 'shortcuts.refresh',          defaultBinding: mkBinding('r') },
  { id: 'openSettings',     labelKey: 'shortcuts.openSettings',     defaultBinding: mkBinding(',') },
  { id: 'toggleTerminal',   labelKey: 'shortcuts.toggleTerminal',   defaultBinding: mkBinding('`') },
  { id: 'fetchAll',         labelKey: 'shortcuts.fetchAll',         defaultBinding: mkBinding('f', { shift: true }) },
  { id: 'search',           labelKey: 'shortcuts.search',           defaultBinding: mkBinding('f') },
  { id: 'prevCommit',       labelKey: 'shortcuts.prevCommit',       defaultBinding: { key: 'ArrowUp', alt: true } },
  { id: 'nextCommit',       labelKey: 'shortcuts.nextCommit',       defaultBinding: { key: 'ArrowDown', alt: true } },
  { id: 'commit',           labelKey: 'shortcuts.commit',           defaultBinding: mkBinding('Enter') },
  { id: 'toggleDiffLayout', labelKey: 'shortcuts.toggleDiffLayout', defaultBinding: mkBinding('d', { shift: true }) },
]

// 当默认绑定变更（平台策略调整、新增 action）时升级此版本号以清除旧存储
const STORAGE_VERSION = 2
const STORAGE_KEY = 'gitui.shortcuts.bindings'
const STORAGE_VER_KEY = 'gitui.shortcuts.version'

function loadBindings(): Record<ShortcutActionId, KeyBinding | null> {
  const defaults = Object.fromEntries(
    SHORTCUT_DEFS.map((d) => [d.id, d.defaultBinding]),
  ) as Record<ShortcutActionId, KeyBinding | null>

  try {
    // 版本号不匹配时清除旧数据，使用新默认值
    const savedVer = Number(localStorage.getItem(STORAGE_VER_KEY) ?? '0')
    if (savedVer < STORAGE_VERSION) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.setItem(STORAGE_VER_KEY, String(STORAGE_VERSION))
      return defaults
    }

    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const saved = JSON.parse(raw) as Partial<Record<ShortcutActionId, KeyBinding | null>>
    // 新增的 action 用默认值补全
    return { ...defaults, ...saved }
  } catch {
    return defaults
  }
}

function saveBindings(bindings: Record<ShortcutActionId, KeyBinding | null>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
  localStorage.setItem(STORAGE_VER_KEY, String(STORAGE_VERSION))
}

/** 将 KeyBinding 转成可读字符串，如 "⌘+Shift+R" */
export function bindingToLabel(b: KeyBinding | null): string {
  if (!b) return '—'
  const parts: string[] = []
  if (b.ctrl) parts.push('Ctrl')
  if (b.meta) parts.push(IS_MAC ? '⌘' : 'Meta')
  if (b.alt) parts.push(IS_MAC ? '⌥' : 'Alt')
  if (b.shift) parts.push('⇧')
  const k = b.key.length === 1 ? b.key.toUpperCase() : b.key
  parts.push(k)
  return parts.join('+')
}

/** 检查 KeyboardEvent 是否匹配绑定 */
export function matchesBinding(e: KeyboardEvent, b: KeyBinding | null): boolean {
  if (!b) return false
  // 单字符键不区分大小写（Shift 会改变 e.key 的大小写，但绑定里可能存小写）
  const normalize = (k: string) => (k.length === 1 ? k.toLowerCase() : k)
  if (normalize(e.key) !== normalize(b.key)) return false
  if (!!b.ctrl !== e.ctrlKey) return false
  if (!!b.meta !== e.metaKey) return false
  if (!!b.shift !== e.shiftKey) return false
  if (!!b.alt !== e.altKey) return false
  return true
}

export const useShortcutsStore = defineStore('shortcuts', () => {
  const bindings = ref<Record<ShortcutActionId, KeyBinding | null>>(loadBindings())

  function setBinding(id: ShortcutActionId, binding: KeyBinding | null) {
    bindings.value = { ...bindings.value, [id]: binding }
    saveBindings(bindings.value)
  }

  function resetBinding(id: ShortcutActionId) {
    const def = SHORTCUT_DEFS.find((d) => d.id === id)
    setBinding(id, def?.defaultBinding ?? null)
  }

  function resetAll() {
    const defaults = Object.fromEntries(
      SHORTCUT_DEFS.map((d) => [d.id, d.defaultBinding]),
    ) as Record<ShortcutActionId, KeyBinding | null>
    bindings.value = defaults
    saveBindings(defaults)
  }

  return { bindings, setBinding, resetBinding, resetAll }
})
