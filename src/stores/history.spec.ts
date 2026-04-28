import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useHistoryStore } from './history'
import { useRepoStore } from './repos'
import { useUiStore } from './ui'
import type { LogPage } from '@/types/git'

const { getLogMock } = vi.hoisted(() => ({
  getLogMock: vi.fn(),
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
  }),
}))

function page(hasMore = false): LogPage {
  return {
    commits: [
      {
        oid: 'aaa',
        short_oid: 'aaa',
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
      },
    ],
    has_more: hasMore,
    total_loaded: 1,
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
})
