import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToolbarGitActions } from './useToolbarGitActions'

const mocks = vi.hoisted(() => ({
  repoStore: {
    activeRepoId: 'repo-a' as string | null,
    activeRepo: vi.fn(() => ({ path: '/repos/a' })),
  },
  historyStore: {
    branches: [{ name: 'main', is_head: true, is_remote: false }],
    loadLog: vi.fn(),
    loadBranches: vi.fn(),
    loadRemoteTags: vi.fn(),
    selectedCommit: null,
    selectedWip: false,
    showDetail: false,
  },
  workspaceStore: {
    status: { staged: [], unstaged: [], untracked: [], head_commit: 'head' },
    undoCommitCandidate: null,
    commitDraft: '',
    refresh: vi.fn(),
    clearUndoCommitCandidate: vi.fn(),
  },
  repoOpsStore: {
    getBusy: vi.fn(() => ({
      pull: false,
      push: false,
      fetch: false,
      stash: false,
      pop: false,
      refresh: false,
    })),
    setBusy: vi.fn(),
  },
  uiStore: { fetchTarget: '', fetchSignal: 0 },
  git: {
    fetchRemote: vi.fn(),
    listRemotes: vi.fn(),
  },
}))

vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repoStore }))
vi.mock('@/stores/history', () => ({ useHistoryStore: () => mocks.historyStore }))
vi.mock('@/stores/stash', () => ({
  useStashStore: () => ({ entries: [], refresh: vi.fn(), push: vi.fn(), pop: vi.fn() }),
}))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => mocks.workspaceStore }))
vi.mock('@/stores/repoOps', () => ({ useRepoOpsStore: () => mocks.repoOpsStore }))
vi.mock('@/stores/ui', () => ({ useUiStore: () => mocks.uiStore }))
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({}),
  resolveExternalTerminalApp: () => null,
}))
vi.mock('@/stores/shortcuts', () => ({
  useShortcutsStore: () => ({ bindings: {} }),
  bindingToLabel: () => '',
}))
vi.mock('@/composables/useGitCommands', () => ({ useGitCommands: () => mocks.git }))
vi.mock('@/composables/useRepoCreation', () => ({
  useRepoCreation: () => ({ showMenuAt: vi.fn() }),
}))
vi.mock('@/composables/useRepositoryRefresh', () => ({
  useRepositoryRefresh: () => ({ refreshActiveRepository: vi.fn() }),
}))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showToast: vi.fn(),
    showError: vi.fn(),
    showActionError: vi.fn(),
  }),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useToolbarGitActions fetch context', () => {
  beforeEach(() => {
    mocks.repoStore.activeRepoId = 'repo-a'
    mocks.repoStore.activeRepo.mockReturnValue({ path: '/repos/a' })
    mocks.uiStore.fetchTarget = ''
    mocks.git.fetchRemote.mockReset().mockResolvedValue(undefined)
    mocks.git.listRemotes.mockReset().mockResolvedValue([])
    mocks.historyStore.loadLog.mockReset().mockResolvedValue(undefined)
    mocks.historyStore.loadBranches.mockReset().mockResolvedValue(undefined)
    mocks.historyStore.loadRemoteTags.mockReset().mockResolvedValue(undefined)
    mocks.repoOpsStore.setBusy.mockReset()
  })

  it('does not fetch after the repository changes during remote selection', async () => {
    const selection = deferred<string | null>()
    const actions = useToolbarGitActions({
      fetchBtnRef: ref(null),
      pickRemote: vi.fn(() => selection.promise),
    })
    const pending = actions.onFetch()
    mocks.repoStore.activeRepoId = 'repo-b'

    selection.resolve('origin')
    await pending

    expect(mocks.git.fetchRemote).not.toHaveBeenCalled()
  })

  it('does not query the old repository when a stale selection is cancelled', async () => {
    const selection = deferred<string | null>()
    const actions = useToolbarGitActions({
      fetchBtnRef: ref(null),
      pickRemote: vi.fn(() => selection.promise),
    })
    const pending = actions.onFetch()
    mocks.repoStore.activeRepoId = 'repo-b'

    selection.resolve(null)
    await pending

    expect(mocks.git.listRemotes).not.toHaveBeenCalled()
    expect(mocks.git.fetchRemote).not.toHaveBeenCalled()
  })

  it('does not refresh the new repository after an old fetch completes', async () => {
    const fetch = deferred<void>()
    mocks.git.fetchRemote.mockReturnValueOnce(fetch.promise)
    const actions = useToolbarGitActions({
      fetchBtnRef: ref(null),
      pickRemote: vi.fn().mockResolvedValue('origin'),
    })
    const pending = actions.onFetch()
    await Promise.resolve()
    mocks.repoStore.activeRepoId = 'repo-b'

    fetch.resolve()
    await pending

    expect(mocks.git.fetchRemote).toHaveBeenCalledWith('repo-a', 'origin')
    expect(mocks.historyStore.loadLog).not.toHaveBeenCalled()
    expect(mocks.historyStore.loadBranches).not.toHaveBeenCalled()
    expect(mocks.repoOpsStore.setBusy).toHaveBeenLastCalledWith('repo-a', 'fetch', false)
  })
})
