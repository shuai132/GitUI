import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { useAutomaticRepositoryRefresh } from './useAutomaticRepositoryRefresh'
import type { StatusChangedPayload } from './useGitEvents'
import { useRepoStore } from '@/stores/repos'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDiffStore } from '@/stores/diff'
import { useHistoryStore } from '@/stores/history'
import { GitCommandError } from '@/lib/gitCommandError'
import type { FileDiff, LogPage, WorkspaceStatus } from '@/types/git'

const mocks = vi.hoisted(() => ({
  statusHandler: undefined as ((payload: StatusChangedPayload) => void) | undefined,
  focusHandler: undefined as ((event: { payload: boolean }) => void) | undefined,
  unlistenFocus: vi.fn(),
  onFocusChanged: vi.fn(),
  commands: {
    getStatus: vi.fn(), getLog: vi.fn(), listBranches: vi.fn(), listRemotes: vi.fn(),
    listTags: vi.fn(), stashList: vi.fn(), listSubmodules: vi.fn(), getFileDiff: vi.fn(),
  },
}))

vi.mock('./useGitEvents', () => ({
  useGitEvents: () => ({
    onStatusChanged: (handler: (payload: StatusChangedPayload) => void) => {
      mocks.statusHandler = handler
    },
  }),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onFocusChanged: mocks.onFocusChanged }),
}))
vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    async get() { return null }
    async set() {}
    async save() {}
  },
}))
vi.mock('./useGitCommands', () => ({ useGitCommands: () => mocks.commands }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

function status(head: string, modified = false): WorkspaceStatus {
  return {
    head_commit: head,
    staged: [], untracked: [],
    unstaged: modified
      ? [{ path: 'app.ts', status: 'modified', staged: false, additions: 1, deletions: 0 }]
      : [],
    is_detached: false,
    repo_state: { kind: 'clean' },
  }
}

const emptyLog: LogPage = { snapshot_id: 'empty', commits: [], has_more: false, total_loaded: 0 }
const diff: FileDiff = {
  old_path: 'app.ts', new_path: 'app.ts', is_binary: false,
  hunks: [], additions: 1, deletions: 0, encoding: 'UTF-8',
}

describe('automatic repository refresh', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    setActivePinia(createPinia())
    const repos = useRepoStore()
    repos.repos = [
      { id: 'a', name: 'a', path: '/repos/a' },
      { id: 'b', name: 'b', path: '/repos/b' },
    ]
    repos.activeRepoId = 'a'
    useWorkspaceStore().status = status('old', true)
    mocks.commands.getStatus.mockResolvedValue(status('old', true))
    mocks.commands.getLog.mockResolvedValue(emptyLog)
    mocks.commands.listBranches.mockResolvedValue([])
    mocks.commands.listRemotes.mockResolvedValue([])
    mocks.commands.listTags.mockResolvedValue([])
    mocks.commands.stashList.mockResolvedValue([])
    mocks.commands.listSubmodules.mockResolvedValue([])
    mocks.commands.getFileDiff.mockResolvedValue(diff)
    mocks.onFocusChanged.mockImplementation((handler: (event: { payload: boolean }) => void) => {
      mocks.focusHandler = handler
      return Promise.resolve(mocks.unlistenFocus)
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.useRealTimers()
  })

  function start() {
    wrapper = mount(defineComponent({
      setup() { useAutomaticRepositoryRefresh() },
      template: '<div />',
    }))
  }

  function event(kind: StatusChangedPayload['kind'], repo_id = 'a') {
    mocks.statusHandler?.({ repo_id, kind })
  }

  it('reads the final committed state after changes arrive during a slow refresh', async () => {
    const first = deferred<WorkspaceStatus>()
    mocks.commands.getStatus.mockReturnValueOnce(first.promise).mockResolvedValue(status('new'))
    const diffStore = useDiffStore()
    diffStore.currentPath = 'app.ts'
    diffStore.currentDiff = diff
    start()
    event('worktree')
    event('refs')
    event('config')
    event('index')
    expect(mocks.commands.getStatus).toHaveBeenCalledTimes(1)
    first.resolve(status('old', true))
    await flushPromises()
    expect(mocks.commands.getStatus).toHaveBeenCalledTimes(2)
    expect(useWorkspaceStore().status?.head_commit).toBe('new')
    expect(useWorkspaceStore().status?.unstaged).toEqual([])
    expect(diffStore.currentPath).toBeNull()
    expect(mocks.commands.getLog).toHaveBeenCalledTimes(1)
    expect(mocks.commands.listSubmodules).toHaveBeenCalledTimes(1)
    expect(mocks.commands.listTags).toHaveBeenCalledTimes(1)
    expect(mocks.commands.stashList).toHaveBeenCalledTimes(1)
  })

  it('waits for history work before starting the next automatic round', async () => {
    const log = deferred<LogPage>()
    mocks.commands.getLog.mockReturnValueOnce(log.promise)
    start()
    event('refs')
    await flushPromises()
    event('worktree')
    expect(mocks.commands.getStatus).toHaveBeenCalledTimes(1)
    log.resolve(emptyLog)
    await flushPromises()
    expect(mocks.commands.getStatus).toHaveBeenCalledTimes(2)
    expect(mocks.commands.getLog).toHaveBeenCalledTimes(1)
  })

  it('keeps ordinary edits in the workspace domain but detects HEAD changes', async () => {
    start()
    event('worktree')
    await flushPromises()
    expect(mocks.commands.getLog).not.toHaveBeenCalled()
    expect(mocks.commands.listSubmodules).not.toHaveBeenCalled()
    mocks.commands.getStatus.mockResolvedValue(status('new'))
    event('index')
    await flushPromises()
    expect(mocks.commands.getLog).toHaveBeenCalledTimes(1)
  })

  it('preserves the current WIP diff on transient failure and retries to the final state', async () => {
    mocks.commands.getStatus.mockRejectedValueOnce(new GitCommandError('读取失败', {
      kind: 'Git', message: 'the index is locked',
    })).mockResolvedValue(status('new'))
    const diffStore = useDiffStore()
    diffStore.currentPath = 'app.ts'
    diffStore.currentDiff = diff
    start()
    event('refs')
    await flushPromises()
    expect(diffStore.currentDiff).toEqual(diff)
    expect(mocks.commands.getLog).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(useWorkspaceStore().status?.head_commit).toBe('new')
    expect(diffStore.currentPath).toBeNull()
    expect(mocks.commands.getLog).toHaveBeenCalledTimes(1)
  })

  it('does not retry permanent status failures', async () => {
    mocks.commands.getStatus.mockRejectedValue(new GitCommandError('仓库不存在', {
      kind: 'RepoNotFound', message: 'repository not found',
    }))
    start()
    event('refs')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.commands.getStatus).toHaveBeenCalledTimes(1)
    expect(useWorkspaceStore().status?.head_commit).toBe('old')
  })

  it('does not follow an old repository response into the newly active repository', async () => {
    const first = deferred<WorkspaceStatus>()
    mocks.commands.getStatus.mockReturnValueOnce(first.promise).mockResolvedValue(status('b-head'))
    start()
    event('refs')
    event('config')
    useRepoStore().activeRepoId = 'b'
    useWorkspaceStore().reset(status('b-head'))
    useHistoryStore().reset()
    event('worktree', 'b')
    first.resolve(status('a-head'))
    await flushPromises()
    expect(useWorkspaceStore().status?.head_commit).toBe('b-head')
    expect(mocks.commands.getStatus.mock.calls).toEqual([['a'], ['b']])
    expect(mocks.commands.getLog).not.toHaveBeenCalled()
    expect(mocks.commands.listSubmodules).not.toHaveBeenCalled()
  })

  it('recovers on window focus and removes the listener and pending work on unmount', async () => {
    mocks.commands.getStatus.mockResolvedValue(status('new'))
    start()
    await flushPromises()
    mocks.focusHandler?.({ payload: true })
    await flushPromises()
    expect(useWorkspaceStore().status?.head_commit).toBe('new')
    expect(mocks.commands.getLog).toHaveBeenCalledTimes(1)
    mocks.focusHandler?.({ payload: true })
    wrapper?.unmount()
    wrapper = undefined
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.unlistenFocus).toHaveBeenCalledTimes(1)
    expect(mocks.commands.getStatus).toHaveBeenCalledTimes(1)
  })

  it('disposes a focus listener whose registration finishes after unmount', async () => {
    const registered = deferred<() => void>()
    mocks.onFocusChanged.mockReturnValueOnce(registered.promise)
    start()
    wrapper?.unmount()
    wrapper = undefined
    registered.resolve(mocks.unlistenFocus)
    await flushPromises()
    expect(mocks.unlistenFocus).toHaveBeenCalledTimes(1)
  })
})
