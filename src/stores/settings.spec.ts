import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type ResolvedTheme = 'light' | 'dark'
type TauriThemeHandler = (event: { payload: ResolvedTheme }) => void

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()

  const mql = {
    get matches() {
      return matches
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
      if (typeof listener === 'function') {
        listeners.add(listener as (event: MediaQueryListEvent) => void)
      }
    },
    removeEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
      if (typeof listener === 'function') {
        listeners.delete(listener as (event: MediaQueryListEvent) => void)
      }
    },
    addListener(listener: (event: MediaQueryListEvent) => void) {
      listeners.add(listener)
    },
    removeListener(listener: (event: MediaQueryListEvent) => void) {
      listeners.delete(listener)
    },
    dispatchEvent() {
      return true
    },
  } as MediaQueryList

  vi.stubGlobal('matchMedia', () => mql)

  return {
    setMatches(next: boolean) {
      matches = next
      const event = { matches, media: mql.media } as MediaQueryListEvent
      for (const listener of listeners) listener(event)
    },
  }
}

function stubLocalStorage() {
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key: string) {
      return values.get(key) ?? null
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
  vi.stubGlobal('localStorage', storage)
}

describe('settings theme mode', () => {
  let setThemeMock: ReturnType<typeof vi.fn>
  let themeHandlers: Set<TauriThemeHandler>
  let currentTauriTheme: ResolvedTheme

  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    stubLocalStorage()
    document.documentElement.removeAttribute('data-theme')
    setActivePinia(createPinia())

    currentTauriTheme = 'light'
    themeHandlers = new Set<TauriThemeHandler>()
    setThemeMock = vi.fn(async (theme?: ResolvedTheme | null) => {
      if (theme === 'light' || theme === 'dark') {
        currentTauriTheme = theme
      }
    })
    vi.doMock('@tauri-apps/api/window', () => ({
      getCurrentWindow: () => ({
        setTheme: setThemeMock,
        theme: async () => currentTauriTheme,
        onThemeChanged: async (handler: TauriThemeHandler) => {
          themeHandlers.add(handler)
          return () => themeHandlers.delete(handler)
        },
      }),
    }))
  })

  it('reacts to system color scheme changes in auto mode', async () => {
    const media = installMatchMedia(false)
    const { useSettingsStore } = await import('./settings')
    const store = useSettingsStore()

    expect(store.themeMode).toBe('auto')
    expect(store.resolvedTheme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    media.setMatches(true)
    await nextTick()

    expect(store.resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    await waitUntil(() => expect(setThemeMock).toHaveBeenCalledWith(null))
  })

  it('keeps explicit theme modes fixed when the system changes', async () => {
    const media = installMatchMedia(false)
    const { useSettingsStore } = await import('./settings')
    const store = useSettingsStore()

    store.themeMode = 'dark'
    await nextTick()
    media.setMatches(false)
    await nextTick()

    expect(store.resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('uses Tauri theme change events for native system updates', async () => {
    installMatchMedia(false)
    const { useSettingsStore } = await import('./settings')
    const store = useSettingsStore()
    await waitUntil(() => expect(themeHandlers.size).toBeGreaterThan(0))

    currentTauriTheme = 'dark'
    for (const handler of themeHandlers) handler({ payload: 'dark' })
    await nextTick()

    expect(store.resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

async function waitUntil(assertion: () => void) {
  let lastError: unknown = null
  for (let i = 0; i < 20; i += 1) {
    try {
      assertion()
      return
    } catch (err) {
      lastError = err
      await new Promise(resolve => setTimeout(resolve, 0))
      await nextTick()
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('waitUntil timed out')
}
