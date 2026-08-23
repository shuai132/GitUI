import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStashStore } from './stash'

const mocks = vi.hoisted(() => ({
  repo: { activeRepoId: 'repo-a' as string | null },
  stashList: vi.fn(),
  stashApply: vi.fn(),
  stashPop: vi.fn(),
  stashDrop: vi.fn(),
  workspaceRefresh: vi.fn(),
  historyLoadLog: vi.fn(),
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({
    stashList: mocks.stashList,
    stashApply: mocks.stashApply,
    stashPop: mocks.stashPop,
    stashDrop: mocks.stashDrop,
  }),
}))

vi.mock('./repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('./workspace', () => ({
  useWorkspaceStore: () => ({ refresh: mocks.workspaceRefresh }),
}))
vi.mock('./history', () => ({
  useHistoryStore: () => ({ loadLog: mocks.historyLoadLog }),
}))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('stash store action context', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.repo.activeRepoId = 'repo-a'
    mocks.stashList.mockReset()
    mocks.stashApply.mockReset()
    mocks.stashPop.mockReset()
    mocks.stashDrop.mockReset()
    mocks.workspaceRefresh.mockReset()
    mocks.historyLoadLog.mockReset()
  })

  it('applies the exact stash in the captured repository', async () => {
    mocks.stashApply.mockResolvedValueOnce(undefined)
    const store = useStashStore()

    await store.apply('repo-a', 2, 'stash-oid')

    expect(mocks.stashApply).toHaveBeenCalledWith('repo-a', 2, 'stash-oid')
    expect(mocks.workspaceRefresh).toHaveBeenCalledWith('repo-a')
  })

  it('does not refresh a newly active repository after an old action completes', async () => {
    const applyPending = deferred()
    mocks.stashApply.mockReturnValueOnce(applyPending.promise)
    const store = useStashStore()

    const request = store.apply('repo-a', 1, 'stash-oid')
    mocks.repo.activeRepoId = 'repo-b'
    applyPending.resolve()
    await request

    expect(mocks.stashApply).toHaveBeenCalledWith('repo-a', 1, 'stash-oid')
    expect(mocks.workspaceRefresh).not.toHaveBeenCalled()
    expect(mocks.stashList).not.toHaveBeenCalled()
    expect(mocks.historyLoadLog).not.toHaveBeenCalled()
  })

  it('keeps pop and drop completion callbacks scoped to their request repository', async () => {
    const popPending = deferred()
    const dropPending = deferred()
    mocks.stashPop.mockReturnValueOnce(popPending.promise)
    mocks.stashDrop.mockReturnValueOnce(dropPending.promise)
    const store = useStashStore()

    const popRequest = store.pop('repo-a', 0, 'pop-oid')
    mocks.repo.activeRepoId = 'repo-b'
    popPending.resolve()
    await popRequest

    const dropRequest = store.drop('repo-a', 3, 'drop-oid')
    dropPending.resolve()
    await dropRequest

    expect(mocks.stashPop).toHaveBeenCalledWith('repo-a', 0, 'pop-oid')
    expect(mocks.stashDrop).toHaveBeenCalledWith('repo-a', 3, 'drop-oid')
    expect(mocks.stashList).not.toHaveBeenCalled()
    expect(mocks.workspaceRefresh).not.toHaveBeenCalled()
    expect(mocks.historyLoadLog).not.toHaveBeenCalled()
  })
})
