import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useHistoryStore } from './history'
import { useRepoStore } from './repos'
import { useUiStore } from './ui'
import type {
  BranchInfo,
  CommitChangeStats,
  CommitSearchPage,
  FileDiff,
  LogPage,
  RemoteInfo,
  TagInfo,
} from '@/types/git'

const {
  getLogMock,
  searchCommitsMock,
  getCommitChangeStatsMock,
  listBranchesMock,
  listRemotesMock,
  listTagsMock,
  getCommitSummaryMock,
  getFileDiffAtCommitMock,
  listRemoteTagsMock,
} = vi.hoisted(() => ({
  getLogMock: vi.fn(),
  searchCommitsMock: vi.fn(),
  getCommitChangeStatsMock: vi.fn(),
  listBranchesMock: vi.fn(),
  listRemotesMock: vi.fn(),
  listTagsMock: vi.fn(),
  getCommitSummaryMock: vi.fn(),
  getFileDiffAtCommitMock: vi.fn(),
  listRemoteTagsMock: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    async get() { return null }
    async set() {}
    async save() {}
  },
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({
    getLog: getLogMock,
    searchCommits: searchCommitsMock,
    getCommitChangeStats: getCommitChangeStatsMock,
    listBranches: listBranchesMock,
    listRemotes: listRemotesMock,
    listTags: listTagsMock,
    getCommitSummary: getCommitSummaryMock,
    getFileDiffAtCommit: getFileDiffAtCommitMock,
    listRemoteTags: listRemoteTagsMock,
  }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function commit(oid: string) {
  return {
    oid,
    short_oid: oid.slice(0, 7),
    message: 'commit',
    summary: 'commit',
    author_name: 'test',
    author_email: 'test@example.com',
    author_time: 1,
    time: 1,
    parent_oids: [],
    is_unreachable: false,
    is_stash: false,
    is_reflog_tip: false,
  }
}

function page(hasMore = false, oids = ['aaa']): LogPage {
  return {
    commits: oids.map(commit),
    has_more: hasMore,
    total_loaded: oids.length,
  }
}

function searchPage(hasMore = false, oids = ['aaa']): CommitSearchPage {
  return {
    commits: oids.map(commit),
    has_more: hasMore,
  }
}

function stat(oid: string): CommitChangeStats {
  return {
    oid,
    files_changed: 1,
    additions: 2,
    deletions: 3,
    binary_files: 0,
    large_blob_count: 0,
    large_blob_bytes: 0,
    largest_blob_bytes: 12,
  }
}

function fileDiff(path: string): FileDiff {
  return {
    old_path: path,
    new_path: path,
    is_binary: false,
    hunks: [{
      old_start: 1,
      old_lines: 1,
      new_start: 1,
      new_lines: 1,
      header: '@@ -1 +1 @@',
      lines: [],
    }],
    additions: 1,
    deletions: 0,
    old_blob_oid: 'old',
    new_blob_oid: 'new',
    encoding: 'UTF-8',
  }
}

function branch(name: string): BranchInfo {
  return {
    name,
    is_remote: false,
    is_head: false,
    commit_oid: `${name}-oid`,
  }
}

function tag(name: string): TagInfo {
  return {
    name,
    ref_oid: `${name}-ref-oid`,
    commit_oid: `${name}-oid`,
    is_annotated: false,
  }
}

function setActiveRepo(repoStore: ReturnType<typeof useRepoStore>, id: string, path: string) {
  repoStore.repos = [{ id, path, name: path.split('/').pop() || id }]
  repoStore.activeRepoId = id
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

describe('history store log filters', () => {
  beforeEach(() => {
    stubLocalStorage()
    getLogMock.mockReset()
    searchCommitsMock.mockReset()
    getCommitChangeStatsMock.mockReset()
    listBranchesMock.mockReset()
    listRemotesMock.mockReset()
    listTagsMock.mockReset()
    getCommitSummaryMock.mockReset()
    getFileDiffAtCommitMock.mockReset()
    listRemoteTagsMock.mockReset()
    setActivePinia(createPinia())
  })

  it('passes current UI filters to loadLog', async () => {
    getLogMock.mockResolvedValueOnce(page())
    const repoStore = useRepoStore()
    const uiStore = useUiStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    uiStore.showUnreachableCommits = false
    uiStore.showStashCommits = true
    uiStore.setHistoryBranchScopeForRepo('/repos/a', 'current_first_parent')
    uiStore.showRemoteBranches = false

    await historyStore.loadLog()

    expect(getLogMock).toHaveBeenCalledWith(
      'repo-1',
      0,
      200,
      false,
      true,
      'current_first_parent',
      false,
    )
  })

  it('searches the full history with the active filters', async () => {
    searchCommitsMock.mockResolvedValueOnce(searchPage(true, ['match']))
    const repoStore = useRepoStore()
    const uiStore = useUiStore()
    const historyStore = useHistoryStore()
    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    uiStore.showUnreachableCommits = false
    uiStore.showStashCommits = true
    uiStore.setHistoryBranchScopeForRepo('/repos/a', 'current_first_parent')
    uiStore.showRemoteBranches = false

    await historyStore.searchCommits('  needle  ')

    expect(searchCommitsMock).toHaveBeenCalledWith(
      'repo-1',
      'needle',
      200,
      false,
      true,
      'current_first_parent',
      false,
    )
    expect(historyStore.commitSearchResults.map((item) => item.oid)).toEqual(['match'])
    expect(historyStore.commitSearchQuery).toBe('needle')
    expect(historyStore.commitSearchHasMore).toBe(true)
  })

  it('keeps the newest full-history search response', async () => {
    const first = deferred<CommitSearchPage>()
    const second = deferred<CommitSearchPage>()
    searchCommitsMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()
    setActiveRepo(repoStore, 'repo-1', '/repos/a')

    const firstSearch = historyStore.searchCommits('first')
    const secondSearch = historyStore.searchCommits('second')
    second.resolve(searchPage(false, ['new']))
    await secondSearch
    first.resolve(searchPage(false, ['old']))
    await firstSearch

    expect(historyStore.commitSearchQuery).toBe('second')
    expect(historyStore.commitSearchResults.map((item) => item.oid)).toEqual(['new'])
    expect(historyStore.commitSearchLoading).toBe(false)
  })

  it('does not scan full history for a one-character query', async () => {
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()
    setActiveRepo(repoStore, 'repo-1', '/repos/a')

    await historyStore.searchCommits('x')

    expect(searchCommitsMock).not.toHaveBeenCalled()
    expect(historyStore.commitSearchResults).toEqual([])
    expect(historyStore.commitSearchLoading).toBe(false)
  })

  it('passes current UI filters to loadMore', async () => {
    getLogMock.mockResolvedValueOnce(page(true)).mockResolvedValueOnce(page(false))
    const repoStore = useRepoStore()
    const uiStore = useUiStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    uiStore.setHistoryBranchScopeForRepo('/repos/a', 'all')
    uiStore.showRemoteBranches = false

    await historyStore.loadLog()
    await historyStore.loadMore()

    expect(getLogMock).toHaveBeenLastCalledWith(
      'repo-1',
      1,
      200,
      true,
      true,
      'all',
      false,
    )
  })

  it('uses the active repo path to choose branch scope', async () => {
    getLogMock.mockResolvedValue(page())
    const repoStore = useRepoStore()
    const uiStore = useUiStore()
    const historyStore = useHistoryStore()

    repoStore.repos = [
      { id: 'repo-1', path: '/repos/a', name: 'a' },
      { id: 'repo-2', path: '/repos/b', name: 'b' },
    ]
    uiStore.setHistoryBranchScopeForRepo('/repos/a', 'current_first_parent')

    repoStore.activeRepoId = 'repo-1'
    await historyStore.loadLog()

    repoStore.activeRepoId = 'repo-2'
    await historyStore.loadLog()

    expect(getLogMock).toHaveBeenNthCalledWith(
      1,
      'repo-1',
      0,
      200,
      true,
      true,
      'current_first_parent',
      true,
    )
    expect(getLogMock).toHaveBeenNthCalledWith(
      2,
      'repo-2',
      0,
      200,
      true,
      true,
      'all',
      true,
    )
  })

  it('ignores a log response after the active repo changes', async () => {
    const pending = deferred<LogPage>()
    getLogMock.mockReturnValueOnce(pending.promise)
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    const load = historyStore.loadLog()

    setActiveRepo(repoStore, 'repo-2', '/repos/b')
    pending.resolve(page(false, ['old']))
    await load

    expect(historyStore.commits).toEqual([])
    expect(historyStore.loading).toBe(false)
  })

  it('lets the latest log request win when requests finish out of order', async () => {
    const older = deferred<LogPage>()
    const newer = deferred<LogPage>()
    getLogMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    const firstLoad = historyStore.loadLog()
    const secondLoad = historyStore.loadLog()

    newer.resolve(page(false, ['new']))
    await secondLoad
    expect(historyStore.commits.map((c) => c.oid)).toEqual(['new'])

    older.resolve(page(false, ['old']))
    await firstLoad
    expect(historyStore.commits.map((c) => c.oid)).toEqual(['new'])
  })

  it('does not append a stale loadMore page after a full log reload', async () => {
    getLogMock.mockResolvedValueOnce(page(true, ['base']))
    const staleMore = deferred<LogPage>()
    const reload = deferred<LogPage>()
    getLogMock
      .mockReturnValueOnce(staleMore.promise)
      .mockReturnValueOnce(reload.promise)
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    await historyStore.loadLog()

    const loadMore = historyStore.loadMore()
    const reloadLog = historyStore.loadLog()

    reload.resolve(page(false, ['fresh']))
    await reloadLog
    staleMore.resolve(page(false, ['stale']))
    await loadMore

    expect(historyStore.commits.map((c) => c.oid)).toEqual(['fresh'])
    expect(historyStore.loadingMore).toBe(false)
  })

  it('ignores change stats that finish after switching repos', async () => {
    const pending = deferred<CommitChangeStats[]>()
    getCommitChangeStatsMock.mockReturnValueOnce(pending.promise)
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    const load = historyStore.ensureCommitChangeStats(['a'])

    setActiveRepo(repoStore, 'repo-2', '/repos/b')
    pending.resolve([stat('a')])
    await load

    expect(historyStore.commitChangeStats.has('a')).toBe(false)
    expect(historyStore.commitChangeStatsLoading.has('a')).toBe(false)
  })

  it('ignores branch and remote responses after the active repo changes', async () => {
    const pendingBranches = deferred<BranchInfo[]>()
    const pendingRemotes = deferred<RemoteInfo[]>()
    listBranchesMock.mockReturnValueOnce(pendingBranches.promise)
    listRemotesMock.mockReturnValueOnce(pendingRemotes.promise)
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    const load = historyStore.loadBranches()

    setActiveRepo(repoStore, 'repo-2', '/repos/b')
    pendingBranches.resolve([branch('main')])
    pendingRemotes.resolve([{ name: 'origin', url: 'https://example.com/repo.git' }])
    await load

    expect(historyStore.branches).toEqual([])
    expect(historyStore.remotes).toEqual([])
  })

  it('ignores tag responses after the active repo changes', async () => {
    const pending = deferred<TagInfo[]>()
    listTagsMock.mockReturnValueOnce(pending.promise)
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    const load = historyStore.loadTags()

    setActiveRepo(repoStore, 'repo-2', '/repos/b')
    pending.resolve([tag('v1.0.0')])
    await load

    expect(historyStore.tags).toEqual([])
  })

  it('does not load more when ensureCommitLoaded finds the target in loaded commits', async () => {
    getLogMock.mockResolvedValueOnce(page(true, ['head']))
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    await historyStore.loadLog()

    await expect(historyStore.ensureCommitLoaded('head')).resolves.toBe(true)

    expect(getLogMock).toHaveBeenCalledTimes(1)
  })

  it('loads more until ensureCommitLoaded finds the target commit', async () => {
    getLogMock
      .mockResolvedValueOnce(page(true, ['newer']))
      .mockResolvedValueOnce(page(true, ['middle']))
      .mockResolvedValueOnce(page(false, ['head']))
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    await historyStore.loadLog()

    await expect(historyStore.ensureCommitLoaded('head')).resolves.toBe(true)

    expect(getLogMock).toHaveBeenCalledTimes(3)
    expect(historyStore.commits.map((c) => c.oid)).toEqual(['newer', 'middle', 'head'])
  })

  it('stops loading when ensureCommitLoaded reaches the end without the target', async () => {
    getLogMock
      .mockResolvedValueOnce(page(true, ['newer']))
      .mockResolvedValueOnce(page(false, ['middle']))
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    await historyStore.loadLog()

    await expect(historyStore.ensureCommitLoaded('missing')).resolves.toBe(false)

    expect(getLogMock).toHaveBeenCalledTimes(2)
    expect(historyStore.commits.map((c) => c.oid)).toEqual(['newer', 'middle'])
  })

  it('stops loading when ensureCommitLoaded is cancelled', async () => {
    getLogMock
      .mockResolvedValueOnce(page(true, ['newer']))
      .mockResolvedValueOnce(page(true, ['middle']))
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    await historyStore.loadLog()

    await expect(historyStore.ensureCommitLoaded('head', () => false)).resolves.toBe(false)

    expect(getLogMock).toHaveBeenCalledTimes(1)
    expect(historyStore.commits.map((c) => c.oid)).toEqual(['newer'])
  })

  it('loads missing change stats once and caches results', async () => {
    getCommitChangeStatsMock.mockResolvedValueOnce([stat('a'), stat('b')])
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    await historyStore.ensureCommitChangeStats(['a', 'b', 'a'])
    await historyStore.ensureCommitChangeStats(['a', 'b'])

    expect(getCommitChangeStatsMock).toHaveBeenCalledTimes(1)
    expect(getCommitChangeStatsMock).toHaveBeenCalledWith('repo-1', ['a', 'b'])
    expect(historyStore.commitChangeStats.get('a')?.additions).toBe(2)
    expect(historyStore.commitChangeStats.get('b')?.deletions).toBe(3)
  })

  it('does not duplicate in-flight change stats requests', async () => {
    let resolveStats!: (value: CommitChangeStats[]) => void
    const pending = new Promise<CommitChangeStats[]>((resolve) => {
      resolveStats = resolve
    })
    getCommitChangeStatsMock.mockReturnValueOnce(pending)
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    const first = historyStore.ensureCommitChangeStats(['a'])
    const second = historyStore.ensureCommitChangeStats(['a'])

    expect(getCommitChangeStatsMock).toHaveBeenCalledTimes(1)
    resolveStats([stat('a')])
    await Promise.all([first, second])

    expect(historyStore.commitChangeStats.get('a')?.files_changed).toBe(1)
  })

  it('clears cached change stats when the active repo changes', async () => {
    getCommitChangeStatsMock
      .mockResolvedValueOnce([stat('a')])
      .mockResolvedValueOnce([stat('b')])
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    await historyStore.ensureCommitChangeStats(['a'])
    expect(historyStore.commitChangeStats.has('a')).toBe(true)

    setActiveRepo(repoStore, 'repo-2', '/repos/b')
    await historyStore.ensureCommitChangeStats(['b'])

    expect(historyStore.commitChangeStats.has('a')).toBe(false)
    expect(historyStore.commitChangeStats.has('b')).toBe(true)
  })

  it('sets pending jump oid for adjacent commit navigation', async () => {
    getLogMock.mockResolvedValueOnce(page(false, ['aaa', 'bbb', 'ccc']))
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    await historyStore.loadLog()
    historyStore.selectedCommit = { info: commit('bbb'), diffs: [] }

    historyStore.jumpAdjacentCommit(1)
    expect(historyStore.pendingJumpOid).toBe('ccc')

    historyStore.pendingJumpOid = null
    historyStore.jumpAdjacentCommit(-1)
    expect(historyStore.pendingJumpOid).toBe('aaa')
  })

  it('selects the first visually ordered file diff', () => {
    const repoStore = useRepoStore()
    const uiStore = useUiStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    historyStore.selectedCommit = {
      info: commit('aaa'),
      diffs: [
        fileDiff('large-generated.html'),
        fileDiff('src/App.vue'),
        fileDiff('src/CanvasPanel.vue'),
      ],
    }
    uiStore.moveChangedFilesForRepo('/repos/a', ['large-generated.html'], 'back')

    historyStore.selectFirstOrderedFileDiff()

    expect(historyStore.selectedFileDiffIndex).toBe(1)
  })

  it('starts adjacent commit navigation from the first commit when nothing is selected', async () => {
    getLogMock.mockResolvedValueOnce(page(false, ['aaa', 'bbb', 'ccc']))
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    await historyStore.loadLog()

    historyStore.jumpAdjacentCommit(-1)

    expect(historyStore.pendingJumpOid).toBe('aaa')
  })

  it('moves from the WIP row to the first commit only when navigating down', async () => {
    getLogMock.mockResolvedValueOnce(page(false, ['aaa', 'bbb', 'ccc']))
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    await historyStore.loadLog()
    historyStore.selectedWip = true

    historyStore.jumpAdjacentCommit(-1)
    expect(historyStore.pendingJumpOid).toBeNull()

    historyStore.jumpAdjacentCommit(1)
    expect(historyStore.pendingJumpOid).toBe('aaa')
  })

  it('reloads the selected file with the whitespace preference and drops stale responses', async () => {
    const repoStore = useRepoStore()
    const uiStore = useUiStore()
    const historyStore = useHistoryStore()
    setActiveRepo(repoStore, 'repo-1', '/repos/a')
    historyStore.selectedCommit = {
      info: commit('commit-1'),
      diffs: [{ ...fileDiff('src/app.ts'), hunks: [] }],
    }

    const visible = deferred<FileDiff>()
    const ignored = deferred<FileDiff>()
    getFileDiffAtCommitMock
      .mockReturnValueOnce(visible.promise)
      .mockReturnValueOnce(ignored.promise)

    const visibleLoad = historyStore.reloadSelectedFileDiff()
    uiStore.toggleDiffIgnoreWhitespace()
    const ignoredLoad = historyStore.reloadSelectedFileDiff()

    const ignoredDiff = { ...fileDiff('src/app.ts'), additions: 7 }
    ignored.resolve(ignoredDiff)
    await ignoredLoad
    visible.resolve({ ...fileDiff('src/app.ts'), additions: 3 })
    await visibleLoad

    expect(getFileDiffAtCommitMock).toHaveBeenNthCalledWith(
      1,
      'repo-1',
      'src/app.ts',
      'commit-1',
      false,
    )
    expect(getFileDiffAtCommitMock).toHaveBeenNthCalledWith(
      2,
      'repo-1',
      'src/app.ts',
      'commit-1',
      true,
    )
    expect(historyStore.selectedCommit.diffs[0].additions).toBe(7)
  })
})
