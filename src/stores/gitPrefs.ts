import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Git 操作偏好配置
 * - autoFetchInterval: 自动 fetch 间隔（秒），0 = 禁用
 */

const KEYS = {
  autoFetchInterval: 'gitui.git.autoFetchInterval',
} as const

function loadNumber(key: string, fallback: number): number {
  const v = localStorage.getItem(key)
  if (v === null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export const FETCH_INTERVAL_OPTIONS = [
  { value: 0,     labelKey: 'settings.gitPrefs.fetchIntervalDisabled' },
  { value: 60,    labelKey: 'settings.gitPrefs.fetchIntervalMinute', params: { n: 1 } },
  { value: 300,   labelKey: 'settings.gitPrefs.fetchIntervalMinute', params: { n: 5 } },
  { value: 600,   labelKey: 'settings.gitPrefs.fetchIntervalMinute', params: { n: 10 } },
  { value: 1800,  labelKey: 'settings.gitPrefs.fetchIntervalMinute', params: { n: 30 } },
] as const

export const useGitPrefsStore = defineStore('gitPrefs', () => {
  const autoFetchInterval = ref<number>(loadNumber(KEYS.autoFetchInterval, 300))

  function setAutoFetchInterval(secs: number) {
    autoFetchInterval.value = secs
    localStorage.setItem(KEYS.autoFetchInterval, String(secs))
  }

  return {
    autoFetchInterval,
    setAutoFetchInterval,
  }
})
