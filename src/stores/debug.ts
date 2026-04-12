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

export interface LogEntry {
  id: number
  ts: number
  level: string
  target: string
  message: string
}

const MAX_ENTRIES = 200
const MAX_LOGS = 500

export const useDebugStore = defineStore('debug', () => {
  const entries = ref<DebugEntry[]>([])
  const logEntries = ref<LogEntry[]>([])
  let nextId = 1
  let nextLogId = 1

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

  function pushLog(level: string, target: string, message: string, ts: number) {
    logEntries.value.unshift({
      id: nextLogId++,
      ts,
      level,
      target,
      message,
    })
    if (logEntries.value.length > MAX_LOGS) {
      logEntries.value.length = MAX_LOGS
    }
  }

  function clear() {
    entries.value = []
  }

  function clearLogs() {
    logEntries.value = []
  }

  return { entries, logEntries, push, resolve, reject, pushLog, clear, clearLogs }
})
