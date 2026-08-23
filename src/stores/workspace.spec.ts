import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from './workspace'
import type { WorkspaceStatus } from '@/types/git'

const mocks = vi.hoisted(() => ({
  repo: { activeRepoId: 'repo-1' as string | null },
  getStatus: vi.fn(),
  createCommit: vi.fn(),
  amendCommit: vi.fn(),
  undoLastCommit: vi.fn(),
  setRepoState: vi.fn(),
}))

vi.mock('./repos', () => ({
  useRepoStore: () => mocks.repo,
}))

vi.mock('./mergeRebase', () => ({
  useMergeRebaseStore: () => ({ setRepoState: mocks.setRepoState }),
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({
    getStatus: mocks.getStatus,
    createCommit: mocks.createCommit,
    amendCommit: mocks.amendCommit,
    undoLastCommit: mocks.undoLastCommit,
  }),
}))

function status(headCommit: string | undefined, unstaged = false): WorkspaceStatus {
  return {
    staged: [],
    unstaged: unstaged
      ? [{ path: 'src/app.ts', status: 'modified', staged: false, additions: 1, deletions: 0 }]
      : [],
    untracked: [],
    head_branch: 'main',
    head_commit: headCommit,
    head_commit_message: 'message',
    is_detached: false,
    repo_state: { kind: 'clean' },
  }
}

describe('workspace commit undo candidate', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.repo.activeRepoId = 'repo-1'
    mocks.getStatus.mockReset()
    mocks.createCommit.mockReset()
    mocks.amendCommit.mockReset()
    mocks.undoLastCommit.mockReset()
    mocks.setRepoState.mockReset()
  })

  it('records a normal commit and restores its message after undo', async () => {
    const store = useWorkspaceStore()
    store.status = status('parent')
    mocks.createCommit.mockResolvedValue('child')
    mocks.getStatus
      .mockResolvedValueOnce(status('child'))
      .mockResolvedValueOnce(status('parent', true))
    mocks.undoLastCommit.mockResolvedValue('parent')

    await store.commit('fix: message')

    expect(store.undoCommitCandidate).toEqual({
      repoId: 'repo-1',
      oid: 'child',
      message: 'fix: message',
    })

    store.commitDraft = ''
    await store.undoLastCommit()

    expect(mocks.undoLastCommit).toHaveBeenCalledWith('repo-1', 'child')
    expect(store.undoCommitCandidate).toBeNull()
    expect(store.commitDraft).toBe('fix: message')
    expect(store.status?.head_commit).toBe('parent')
  })

  it('does not offer undo for a root commit and clears a stale candidate on refresh', async () => {
    const store = useWorkspaceStore()
    store.status = status(undefined)
    mocks.createCommit.mockResolvedValue('root')
    mocks.getStatus.mockResolvedValueOnce(status('root'))

    await store.commit('initial')
    expect(store.undoCommitCandidate).toBeNull()

    store.undoCommitCandidate = { repoId: 'repo-1', oid: 'old', message: 'old' }
    mocks.getStatus.mockResolvedValueOnce(status('new'))
    await store.refresh()
    expect(store.undoCommitCandidate).toBeNull()
  })

  it('preserves a newer draft when undoing the previous commit', async () => {
    const store = useWorkspaceStore()
    store.status = status('child')
    store.undoCommitCandidate = { repoId: 'repo-1', oid: 'child', message: 'old message' }
    store.commitDraft = 'new draft'
    mocks.undoLastCommit.mockResolvedValue('parent')
    mocks.getStatus.mockResolvedValue(status('parent', true))

    await store.undoLastCommit()

    expect(store.commitDraft).toBe('new draft')
  })

  it('only clears the undo candidate for its owning repository', () => {
    const store = useWorkspaceStore()
    store.undoCommitCandidate = { repoId: 'repo-1', oid: 'child', message: 'message' }

    store.clearUndoCommitCandidate('repo-2')
    expect(store.undoCommitCandidate?.oid).toBe('child')

    store.clearUndoCommitCandidate('repo-1')
    expect(store.undoCommitCandidate).toBeNull()
  })
})
