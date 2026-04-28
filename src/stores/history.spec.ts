import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useHistoryStore } from './history'
import { useRepoStore } from './repos'
import { useUiStore } from './ui'
import type { CommitChangeStats, LogPage } from '@/types/git'

const { getLogMock, getCommitChangeStatsMock } = vi.hoisted(() => ({
  getLogMock: vi.fn(),
  getCommitChangeStatsMock: vi.fn(),
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
    getCommitChangeStats: getCommitChangeStatsMock,
  }),
}))

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
    getCommitChangeStatsMock.mockReset()
    setActivePinia(createPinia())
  })

  it('passes current UI filters to loadLog', async () => {
    getLogMock.mockResolvedValueOnce(page())
    const repoStore = useRepoStore()
    const uiStore = useUiStore()
    const historyStore = useHistoryStore()

    repoStore.activeRepoId = 'repo-1'
    uiStore.showUnreachableCommits = false
    uiStore.showStashCommits = true
    uiStore.setHistoryBranchScope('current_first_parent')
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

  it('passes current UI filters to loadMore', async () => {
    getLogMock.mockResolvedValueOnce(page(true)).mockResolvedValueOnce(page(false))
    const repoStore = useRepoStore()
    const uiStore = useUiStore()
    const historyStore = useHistoryStore()

    repoStore.activeRepoId = 'repo-1'
    uiStore.setHistoryBranchScope('all')
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

  it('does not load more when ensureCommitLoaded finds the target in loaded commits', async () => {
    getLogMock.mockResolvedValueOnce(page(true, ['head']))
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    repoStore.activeRepoId = 'repo-1'
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

    repoStore.activeRepoId = 'repo-1'
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

    repoStore.activeRepoId = 'repo-1'
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

    repoStore.activeRepoId = 'repo-1'
    await historyStore.loadLog()

    await expect(historyStore.ensureCommitLoaded('head', () => false)).resolves.toBe(false)

    expect(getLogMock).toHaveBeenCalledTimes(1)
    expect(historyStore.commits.map((c) => c.oid)).toEqual(['newer'])
  })

  it('loads missing change stats once and caches results', async () => {
    getCommitChangeStatsMock.mockResolvedValueOnce([stat('a'), stat('b')])
    const repoStore = useRepoStore()
    const historyStore = useHistoryStore()

    repoStore.activeRepoId = 'repo-1'
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

    repoStore.activeRepoId = 'repo-1'
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

    repoStore.activeRepoId = 'repo-1'
    await historyStore.ensureCommitChangeStats(['a'])
    expect(historyStore.commitChangeStats.has('a')).toBe(true)

    repoStore.activeRepoId = 'repo-2'
    await historyStore.ensureCommitChangeStats(['b'])

    expect(historyStore.commitChangeStats.has('a')).toBe(false)
    expect(historyStore.commitChangeStats.has('b')).toBe(true)
  })
})
