import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  DEFAULT_HISTORY_COLUMN_ORDER,
  moveHistoryColumn,
  normalizeHistoryColumnOrder,
  useUiStore,
  type HistoryColumnId,
} from './ui'

function stubLocalStorage(initial: Record<string, string> = {}) {
  const values = new Map<string, string>(Object.entries(initial))
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

describe('ui store history column preferences', () => {
  beforeEach(() => {
    stubLocalStorage()
    setActivePinia(createPinia())
  })

  it('normalizes saved history column order', () => {
    const order = normalizeHistoryColumnOrder<HistoryColumnId>(
      ['commit', 'unknown', 'commit', 'description'],
      DEFAULT_HISTORY_COLUMN_ORDER,
    )

    expect(order).toEqual(['commit', 'description', 'changes', 'author', 'date'])
  })

  it('moves history columns before and after a target', () => {
    expect(moveHistoryColumn(DEFAULT_HISTORY_COLUMN_ORDER, 'date', 'description')).toEqual([
      'date',
      'description',
      'changes',
      'commit',
      'author',
    ])

    expect(moveHistoryColumn(DEFAULT_HISTORY_COLUMN_ORDER, 'description', 'date', 'after')).toEqual([
      'changes',
      'commit',
      'author',
      'date',
      'description',
    ])
  })

  it('keeps changes column visible by default and persists toggles', () => {
    const uiStore = useUiStore()

    expect(uiStore.showChangeStatsColumn).toBe(true)

    uiStore.toggleShowChangeStatsColumn()

    expect(uiStore.showChangeStatsColumn).toBe(false)
    expect(localStorage.getItem('gitui.history.showChangeStatsColumn')).toBe('false')
  })

  it('persists reordered history columns', () => {
    const uiStore = useUiStore()

    uiStore.moveHistoryColumnTo('date', 'description', 'before')

    expect(uiStore.historyColumnOrder).toEqual([
      'date',
      'description',
      'changes',
      'commit',
      'author',
    ])
    expect(localStorage.getItem('gitui.history.columnOrder')).toBe(
      JSON.stringify(uiStore.historyColumnOrder),
    )
  })
})
