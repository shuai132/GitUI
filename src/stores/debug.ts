import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface DebugEntry {
  id: number
  ts: number
  op: string
  args?: Record<string, unknown>
  duration?: number
  status: 'pending' | 'ok' | 'error'
  error?: string
}

const MAX_ENTRIES = 200

export const useDebugStore = defineStore('debug', () => {
  const entries = ref<DebugEntry[]>([])
  let nextId = 1

  function push(op: string, args?: Record<string, unknown>): DebugEntry {
    const entry: DebugEntry = {
      id: nextId++,
      ts: Date.now(),
      op,
      args: args ? { ...args } : undefined,
      status: 'pending',
    }
    entries.value.unshift(entry)
    if (entries.value.length > MAX_ENTRIES) {
      entries.value.length = MAX_ENTRIES
    }
    return entry
  }

  function resolve(id: number, duration: number) {
    const entry = entries.value.find((e) => e.id === id)
    if (entry) {
      entry.status = 'ok'
      entry.duration = Math.round(duration)
    }
  }

  function reject(id: number, duration: number, error: string) {
    const entry = entries.value.find((e) => e.id === id)
    if (entry) {
      entry.status = 'error'
      entry.duration = Math.round(duration)
      entry.error = error
    }
  }

  function clear() {
    entries.value = []
  }

  return { entries, push, resolve, reject, clear }
})
