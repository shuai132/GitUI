import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  DEFAULT_ADVANCED_VIEW_PREFS,
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

  it('resets advanced view preferences to defaults', () => {
    const uiStore = useUiStore()

    uiStore.setDiffLayoutMode('side-by-side')
    uiStore.setDiffGroupByHunk(false)
    uiStore.setHistoryBranchScopeForRepo('/repos/a', 'current_first_parent')
    uiStore.toggleShowRemoteBranches()
    uiStore.toggleShowChangeStatsColumn()
    uiStore.toggleShowUnreachable()
    uiStore.toggleShowStashes()
    uiStore.toggleDebugPanel()
    uiStore.toggleDetailFilesFirst()

    uiStore.resetAdvancedViewPrefs()

    expect(uiStore.diffLayoutMode).toBe(DEFAULT_ADVANCED_VIEW_PREFS.diffLayoutMode)
    expect(uiStore.diffGroupByHunk).toBe(DEFAULT_ADVANCED_VIEW_PREFS.diffGroupByHunk)
    expect(uiStore.getHistoryBranchScope('/repos/a')).toBe('current_first_parent')
    expect(uiStore.showRemoteBranches).toBe(DEFAULT_ADVANCED_VIEW_PREFS.showRemoteBranches)
    expect(uiStore.showChangeStatsColumn).toBe(DEFAULT_ADVANCED_VIEW_PREFS.showChangeStatsColumn)
    expect(uiStore.showUnreachableCommits).toBe(DEFAULT_ADVANCED_VIEW_PREFS.showUnreachableCommits)
    expect(uiStore.showStashCommits).toBe(DEFAULT_ADVANCED_VIEW_PREFS.showStashCommits)
    expect(uiStore.debugPanelVisible).toBe(DEFAULT_ADVANCED_VIEW_PREFS.debugPanelVisible)
    expect(uiStore.detailFilesFirst).toBe(DEFAULT_ADVANCED_VIEW_PREFS.detailFilesFirst)
    expect(localStorage.getItem('gitui.diff.layoutMode')).toBe(DEFAULT_ADVANCED_VIEW_PREFS.diffLayoutMode)
    expect(localStorage.getItem('gitui.history.branchScopeByRepoPath')).toBe(
      JSON.stringify({ '/repos/a': 'current_first_parent' }),
    )
  })

  it('persists history branch scope per repo path', () => {
    const uiStore = useUiStore()

    expect(uiStore.getHistoryBranchScope('/repos/a')).toBe('all')
    expect(uiStore.getHistoryBranchScope('/repos/b')).toBe('all')

    uiStore.setHistoryBranchScopeForRepo('/repos/a', 'current_first_parent')

    expect(uiStore.getHistoryBranchScope('/repos/a')).toBe('current_first_parent')
    expect(uiStore.getHistoryBranchScope('/repos/b')).toBe('all')
    expect(localStorage.getItem('gitui.history.branchScopeByRepoPath')).toBe(
      JSON.stringify({ '/repos/a': 'current_first_parent' }),
    )

    uiStore.toggleHistoryBranchScopeForRepo('/repos/a')

    expect(uiStore.getHistoryBranchScope('/repos/a')).toBe('all')
    expect(localStorage.getItem('gitui.history.branchScopeByRepoPath')).toBeNull()
  })

  it('falls back to default history branch scope for invalid scoped storage', () => {
    stubLocalStorage({
      'gitui.history.branchScopeByRepoPath': JSON.stringify({
        '/repos/a': 'current_first_parent',
        '/repos/b': 'invalid',
        '': 'current_first_parent',
      }),
    })
    setActivePinia(createPinia())

    const uiStore = useUiStore()

    expect(uiStore.getHistoryBranchScope('/repos/a')).toBe('current_first_parent')
    expect(uiStore.getHistoryBranchScope('/repos/b')).toBe('all')
    expect(uiStore.getHistoryBranchScope('/repos/c')).toBe('all')
  })

  it('ignores legacy global history branch scope at runtime', () => {
    stubLocalStorage({
      'gitui.history.branchScope': 'current_first_parent',
    })
    setActivePinia(createPinia())

    const uiStore = useUiStore()

    expect(uiStore.getHistoryBranchScope('/repos/a')).toBe('all')
  })
})
