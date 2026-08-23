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

  it('keeps changes column hidden by default and persists toggles', () => {
    const uiStore = useUiStore()

    expect(uiStore.showChangeStatsColumn).toBe(false)

    uiStore.toggleShowChangeStatsColumn()

    expect(uiStore.showChangeStatsColumn).toBe(true)
    expect(localStorage.getItem('gitui.history.showChangeStatsColumn')).toBe('true')
  })

  it('keeps whitespace changes visible by default and persists the diff toggle', () => {
    const uiStore = useUiStore()

    expect(uiStore.diffIgnoreWhitespace).toBe(false)

    uiStore.toggleDiffIgnoreWhitespace()

    expect(uiStore.diffIgnoreWhitespace).toBe(true)
    expect(localStorage.getItem('gitui.diff.ignoreWhitespace')).toBe('true')
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
    uiStore.toggleDiffHighlight()
    uiStore.toggleDiffIgnoreWhitespace()
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
    expect(uiStore.diffHighlightEnabled).toBe(DEFAULT_ADVANCED_VIEW_PREFS.diffHighlightEnabled)
    expect(uiStore.diffIgnoreWhitespace).toBe(DEFAULT_ADVANCED_VIEW_PREFS.diffIgnoreWhitespace)
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

  it('persists default remote per repo path', () => {
    const uiStore = useUiStore()

    expect(uiStore.getDefaultRemote('/repos/a')).toBeNull()

    uiStore.setDefaultRemoteForRepo('/repos/a', 'origin')
    uiStore.setDefaultRemoteForRepo('/repos/b', 'gitlab')

    expect(uiStore.getDefaultRemote('/repos/a')).toBe('origin')
    expect(uiStore.getDefaultRemote('/repos/b')).toBe('gitlab')
    expect(localStorage.getItem('gitui.remote.defaultByRepoPath')).toBe(
      JSON.stringify({ '/repos/a': 'origin', '/repos/b': 'gitlab' }),
    )

    uiStore.clearDefaultRemoteForRepo('/repos/a')

    expect(uiStore.getDefaultRemote('/repos/a')).toBeNull()
    expect(localStorage.getItem('gitui.remote.defaultByRepoPath')).toBe(
      JSON.stringify({ '/repos/b': 'gitlab' }),
    )

    uiStore.clearDefaultRemoteForRepo('/repos/b')

    expect(localStorage.getItem('gitui.remote.defaultByRepoPath')).toBeNull()
  })

  it('drops invalid default remote storage entries', () => {
    stubLocalStorage({
      'gitui.remote.defaultByRepoPath': JSON.stringify({
        '/repos/a': 'origin',
        '/repos/b': '',
        '': 'gitlab',
      }),
    })
    setActivePinia(createPinia())

    const uiStore = useUiStore()

    expect(uiStore.getDefaultRemote('/repos/a')).toBe('origin')
    expect(uiStore.getDefaultRemote('/repos/b')).toBeNull()
  })

  it('persists changed file order per repo path', () => {
    const uiStore = useUiStore()

    uiStore.moveChangedFilesForRepo('/repos/a', ['lock.json'], 'back')
    uiStore.moveChangedFilesForRepo('/repos/b', ['generated.bin'], 'front')

    expect(uiStore.getChangedFileOrder('/repos/a')).toEqual({
      front: [],
      back: ['lock.json'],
    })
    expect(uiStore.getChangedFileOrder('/repos/b')).toEqual({
      front: ['generated.bin'],
      back: [],
    })
    expect(localStorage.getItem('gitui.changedFiles.orderByRepoPath')).toBe(
      JSON.stringify({
        '/repos/a': { front: [], back: ['lock.json'] },
        '/repos/b': { front: ['generated.bin'], back: [] },
      }),
    )

    uiStore.moveChangedFilesForRepo('/repos/a', ['lock.json'], 'default')

    expect(uiStore.getChangedFileOrder('/repos/a')).toEqual({ front: [], back: [] })
    expect(localStorage.getItem('gitui.changedFiles.orderByRepoPath')).toBe(
      JSON.stringify({
        '/repos/b': { front: ['generated.bin'], back: [] },
      }),
    )
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
