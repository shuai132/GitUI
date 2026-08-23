import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStatus } from '@/types/git'
import { useMergeRebaseStore } from './mergeRebase'

const status: WorkspaceStatus = {
  staged: [],
  unstaged: [
    {
      path: 'src/app.ts',
      status: 'modified',
      staged: false,
      additions: 1,
      deletions: 0,
    },
  ],
  untracked: [],
  head_branch: 'main',
  head_commit: '1111111111111111111111111111111111111111',
  is_detached: false,
  repo_state: { kind: 'clean' },
}

const mocks = vi.hoisted(() => ({
  repo: { activeRepoId: 'repo-1' as string | null },
  workspace: { status: null as WorkspaceStatus | null, refresh: vi.fn() },
  history: { loadLog: vi.fn(), loadBranches: vi.fn() },
  stash: { refresh: vi.fn() },
  git: {
    stashPush: vi.fn(),
    stashPop: vi.fn(),
    getRepoState: vi.fn(),
    mergeBranch: vi.fn(),
    rebaseStart: vi.fn(),
  },
}))

vi.mock('./repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('./workspace', () => ({ useWorkspaceStore: () => mocks.workspace }))
vi.mock('./history', () => ({ useHistoryStore: () => mocks.history }))
vi.mock('./stash', () => ({ useStashStore: () => mocks.stash }))
vi.mock('@/composables/useGitCommands', () => ({ useGitCommands: () => mocks.git }))

describe('merge and rebase auto-stash lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.repo.activeRepoId = 'repo-1'
    mocks.workspace.status = status
    for (const mock of Object.values(mocks.git)) mock.mockReset()
    mocks.workspace.refresh.mockReset().mockResolvedValue(undefined)
    mocks.history.loadLog.mockReset().mockResolvedValue(undefined)
    mocks.history.loadBranches.mockReset().mockResolvedValue(undefined)
    mocks.stash.refresh.mockReset().mockResolvedValue(undefined)
    mocks.git.stashPush.mockResolvedValue('auto-stash-oid')
    mocks.git.stashPop.mockResolvedValue(undefined)
    mocks.git.mergeBranch.mockResolvedValue(undefined)
    mocks.git.rebaseStart.mockResolvedValue(undefined)
  })

  it('keeps original changes stashed when Merge stops on a conflict', async () => {
    const conflict = new Error('merge conflict')
    mocks.git.mergeBranch.mockRejectedValue(conflict)
    mocks.git.getRepoState.mockResolvedValue({ kind: 'merge' })
    const store = useMergeRebaseStore()

    await expect(store.startMerge(
      'repo-1',
      'feature',
      'auto',
      null,
      true,
      status.head_commit!,
      'refs/heads/main',
      '2222222222222222222222222222222222222222',
    )).rejects.toThrow(/Stash/)

    expect(mocks.git.stashPush).toHaveBeenCalledOnce()
    expect(mocks.git.getRepoState).toHaveBeenCalledWith('repo-1')
    expect(mocks.git.stashPop).not.toHaveBeenCalled()
    expect(mocks.stash.refresh).toHaveBeenCalledOnce()
  })

  it('restores original changes after a clean Rebase', async () => {
    const order: string[] = []
    mocks.git.stashPush.mockImplementation(async () => {
      order.push('stash')
      return 'auto-stash-oid'
    })
    mocks.git.rebaseStart.mockImplementation(async () => { order.push('rebase') })
    mocks.git.getRepoState.mockImplementation(async () => {
      order.push('state')
      return { kind: 'clean' }
    })
    mocks.git.stashPop.mockImplementation(async () => { order.push('restore') })
    const store = useMergeRebaseStore()

    await store.startRebase(
      'repo-1',
      '2222222222222222222222222222222222222222',
      null,
      [],
      true,
      status.head_commit!,
      'refs/heads/main',
      '2222222222222222222222222222222222222222',
      null,
    )

    expect(order).toEqual(['stash', 'rebase', 'state', 'restore'])
    expect(mocks.git.stashPop).toHaveBeenCalledWith('repo-1', 0, 'auto-stash-oid')
    expect(mocks.stash.refresh).toHaveBeenCalledOnce()
    expect(store.lastError).toBeNull()
  })
})
