import { defineStore } from 'pinia'
import { ref } from 'vue'
import { mapGitError } from '@/lib/errorMap'
import { i18n } from '@/i18n'

export interface ErrorEntry {
  /** 递增 id，用作列表 key */
  id: number
  /** 发生时间（毫秒） */
  ts: number
  /** 命令名，例如 "push_branch" / "get_log" */
  op: string
  /** 中文友好消息（用于 toast / 历史列表首行） */
  friendly: string
  /** 原始错误的字符串化形式（展开用） */
  raw: string
}

const MAX_ENTRIES = 30

export const useErrorsStore = defineStore('errors', () => {
  const entries = ref<ErrorEntry[]>([])
  /** 最近一条的 id —— toast 通过 watch 这个变化弹出 */
  const latestId = ref(0)
  let nextId = 1

  function push(op: string, raw: unknown): ErrorEntry {
    const entry: ErrorEntry = {
      id: nextId++,
      ts: Date.now(),
      op,
      friendly: formatFriendly(op, raw),
      raw: rawToString(raw),
    }
    entries.value.unshift(entry)
    if (entries.value.length > MAX_ENTRIES) {
      entries.value.length = MAX_ENTRIES
    }
    latestId.value = entry.id
    return entry
  }

  function clear() {
    entries.value = []
  }

  return {
    entries,
    latestId,
    push,
    clear,
  }
})

/**
 * 把 mapGitError 产出的 i18n key 翻译成当前 locale 下的字符串。
 * key 缺失翻译时回退到 fallbackText（通常是原始 message）。
 */
function formatFriendly(op: string, raw: unknown): string {
  const fe = mapGitError(op, raw)
  const translated = i18n.global.t(fe.key, fe.params ?? {})
  if (translated && translated !== fe.key) return translated
  return fe.fallbackText ?? translated
}

function rawToString(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw instanceof Error) return raw.message
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}
