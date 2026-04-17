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
  /**
   * 呈现级别：'error' = 操作失败（红 ✕），'warning' = 需要用户介入的中间状态
   * （橙 ⚠️，如合并/rebase/cherry-pick 冲突）。
   */
  level: 'error' | 'warning'
}

const MAX_ENTRIES = 30

export const useErrorsStore = defineStore('errors', () => {
  const entries = ref<ErrorEntry[]>([])
  /** 最近一条的 id —— toast 通过 watch 这个变化弹出 */
  const latestId = ref(0)
  let nextId = 1

  function push(op: string, raw: unknown): ErrorEntry {
    const fe = mapGitError(op, raw)
    const translated = i18n.global.t(fe.key, fe.params ?? {})
    const friendly = translated && translated !== fe.key ? translated : (fe.fallbackText ?? translated)
    const entry: ErrorEntry = {
      id: nextId++,
      ts: Date.now(),
      op,
      friendly,
      raw: rawToString(raw),
      level: fe.level ?? 'error',
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

function rawToString(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw instanceof Error) return raw.message
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}
