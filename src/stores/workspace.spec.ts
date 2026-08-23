import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from './workspace'
import { useRepoStore } from './repos'
import type { RepoMeta, WorkspaceStatus } from '@/types/git'

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  createCommit: vi.fn(),
  amendCommit: vi.fn(),
  undoLastCommit: vi.fn(),
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  discardAllChanges: vi.fn(),
  discardFiles: vi.fn(),
  setRepoState: vi.fn(),
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
    stageFiles: mocks.stageFiles,
    unstageFiles: mocks.unstageFiles,
    discardAllChanges: mocks.discardAllChanges,
    discardFiles: mocks.discardFiles,
  }),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    async get() { return null }
    async set() {}
    async save() {}
  },
}))

function repo(id: string, name: string): RepoMeta {
  return { id, name, path: `/repos/${name}` }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

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
    localStorage.clear()
    setActivePinia(createPinia())
    const repoStore = useRepoStore()
    repoStore.repos = [repo('repo-1', 'alpha'), repo('repo-2', 'beta')]
    repoStore.activeRepoId = 'repo-1'
    mocks.getStatus.mockReset()
    mocks.createCommit.mockReset()
    mocks.amendCommit.mockReset()
    mocks.undoLastCommit.mockReset()
    mocks.stageFiles.mockReset()
    mocks.unstageFiles.mockReset()
    mocks.discardAllChanges.mockReset()
    mocks.discardFiles.mockReset()
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

  it('discards multiple files with one command and one refresh', async () => {
    const store = useWorkspaceStore()
    mocks.discardFiles.mockResolvedValue(undefined)
    mocks.getStatus.mockResolvedValue(status('head'))

    await store.discardFiles(['one.txt', 'two.txt'])

    expect(mocks.discardFiles).toHaveBeenCalledTimes(1)
    expect(mocks.discardFiles).toHaveBeenCalledWith('repo-1', ['one.txt', 'two.txt'])
    expect(mocks.getStatus).toHaveBeenCalledTimes(1)
  })

  it('passes the confirmed HEAD and path snapshot when discarding everything', async () => {
    const store = useWorkspaceStore()
    mocks.discardAllChanges.mockResolvedValue(undefined)
    mocks.getStatus.mockResolvedValue(status('head'))

    await store.discardAll('repo-1', 'head', ['one.txt', 'two.txt'])

    expect(mocks.discardAllChanges).toHaveBeenCalledWith(
      'repo-1',
      'head',
      ['one.txt', 'two.txt'],
    )
    expect(mocks.getStatus).toHaveBeenCalledWith('repo-1')
  })

  it('stages and unstages multiple files with one command and one refresh each', async () => {
    const store = useWorkspaceStore()
    const paths = ['one.txt', 'two.txt']
    mocks.stageFiles.mockResolvedValue(undefined)
    mocks.unstageFiles.mockResolvedValue(undefined)
    mocks.getStatus.mockResolvedValue(status('head'))

    await store.stageFiles(paths)
    expect(mocks.stageFiles).toHaveBeenCalledTimes(1)
    expect(mocks.stageFiles).toHaveBeenCalledWith('repo-1', paths)
    expect(mocks.getStatus).toHaveBeenCalledTimes(1)

    mocks.getStatus.mockClear()
    await store.unstageFiles(paths)
    expect(mocks.unstageFiles).toHaveBeenCalledTimes(1)
    expect(mocks.unstageFiles).toHaveBeenCalledWith('repo-1', paths)
    expect(mocks.getStatus).toHaveBeenCalledTimes(1)
  })

  it('keeps independent drafts per repository and restores them after store recreation', () => {
    const repoStore = useRepoStore()
    const store = useWorkspaceStore()
    store.commitDraft = 'alpha draft'

    repoStore.activeRepoId = 'repo-2'
    expect(store.commitDraft).toBe('')
    store.commitDraft = 'beta draft'

    repoStore.activeRepoId = 'repo-1'
    expect(store.commitDraft).toBe('alpha draft')

    setActivePinia(createPinia())
    const restoredRepoStore = useRepoStore()
    restoredRepoStore.repos = [repo('repo-new-1', 'alpha'), repo('repo-new-2', 'beta')]
    restoredRepoStore.activeRepoId = 'repo-new-1'
    const restoredStore = useWorkspaceStore()

    expect(restoredStore.commitDraft).toBe('alpha draft')
    restoredRepoStore.activeRepoId = 'repo-new-2'
    expect(restoredStore.commitDraft).toBe('beta draft')
  })

  it('removes the consumed draft after commit and amend succeed', async () => {
    const store = useWorkspaceStore()
    store.status = status('parent')
    store.commitDraft = 'normal message'
    mocks.createCommit.mockResolvedValue('child')
    mocks.getStatus.mockResolvedValueOnce(status('child'))

    await store.commit('normal message')
    expect(store.commitDraft).toBe('')

    store.commitDraft = 'amended message'
    mocks.amendCommit.mockResolvedValue('amended')
    mocks.getStatus.mockResolvedValueOnce(status('amended'))

    await store.amend('amended message')
    expect(store.commitDraft).toBe('')
    expect(localStorage.length).toBe(0)
  })

  it('does not clear a newer draft while an earlier commit is running', async () => {
    const store = useWorkspaceStore()
    store.status = status('parent')
    store.commitDraft = 'submitted message'
    const pendingCommit = deferred<string>()
    mocks.createCommit.mockReturnValueOnce(pendingCommit.promise)
    mocks.getStatus.mockResolvedValueOnce(status('child'))

    const commitPromise = store.commit('submitted message')
    store.commitDraft = 'newer message'
    pendingCommit.resolve('child')
    await commitPromise

    expect(store.commitDraft).toBe('newer message')
  })

  it('retains the draft when commit fails or a consumer has a stale snapshot', async () => {
    const store = useWorkspaceStore()
    store.commitDraft = 'keep this message'
    mocks.createCommit.mockRejectedValueOnce(new Error('commit failed'))

    await expect(store.commit('keep this message')).rejects.toThrow('commit failed')
    store.clearCommitDraftIfUnchanged('/repos/alpha', 'older message')

    expect(store.commitDraft).toBe('keep this message')
  })

  it('clears only the submitted repository draft after switching during commit', async () => {
    const repoStore = useRepoStore()
    const store = useWorkspaceStore()
    store.status = status('parent')
    store.commitDraft = 'alpha message'
    const pendingCommit = deferred<string>()
    mocks.createCommit.mockReturnValueOnce(pendingCommit.promise)
    mocks.getStatus.mockResolvedValueOnce(status('child'))

    const commitPromise = store.commit('alpha message')
    repoStore.activeRepoId = 'repo-2'
    store.commitDraft = 'beta message'
    pendingCommit.resolve('child')
    await commitPromise

    expect(store.commitDraft).toBe('beta message')
    repoStore.activeRepoId = 'repo-1'
    expect(store.commitDraft).toBe('')
    repoStore.activeRepoId = 'repo-2'
    expect(store.commitDraft).toBe('beta message')
  })
})
