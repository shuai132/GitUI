import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRepositoryRefresh } from './useRepositoryRefresh'
import { useDiffStore } from '@/stores/diff'
import { useRepoOpsStore } from '@/stores/repoOps'
import { useRepoStore } from '@/stores/repos'
import type { FileDiff, FileEntry, WorkspaceStatus } from '@/types/git'

const commandMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getLog: vi.fn(),
  listBranches: vi.fn(),
  listRemotes: vi.fn(),
  listTags: vi.fn(),
  stashList: vi.fn(),
  listSubmodules: vi.fn(),
  getFileDiff: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    async get() { return null }
    async set() {}
    async save() {}
  },
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => commandMocks,
}))

function statusWith(files: {
  staged?: FileEntry[]
  unstaged?: FileEntry[]
  untracked?: FileEntry[]
}): WorkspaceStatus {
  return {
    staged: files.staged ?? [],
    unstaged: files.unstaged ?? [],
    untracked: files.untracked ?? [],
    is_detached: false,
    repo_state: { kind: 'clean' },
  }
}

function modifiedFile(path: string, staged: boolean): FileEntry {
  return {
    path,
    status: 'modified',
    staged,
    additions: 1,
    deletions: 0,
  }
}

function fileDiff(path: string): FileDiff {
  return {
    old_path: path,
    new_path: path,
    is_binary: false,
    hunks: [],
    additions: 1,
    deletions: 0,
    encoding: 'UTF-8',
  }
}

function activateRepo() {
  const repoStore = useRepoStore()
  repoStore.repos = [{ id: 'repo-a', name: 'repo-a', path: '/repos/a' }]
  repoStore.activeRepoId = 'repo-a'
}

describe('useRepositoryRefresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    activateRepo()
    vi.clearAllMocks()

    commandMocks.getStatus.mockResolvedValue(
      statusWith({ unstaged: [modifiedFile('src/a.ts', false)] }),
    )
    commandMocks.getLog.mockResolvedValue({ commits: [], has_more: false, total_loaded: 0 })
    commandMocks.listBranches.mockResolvedValue([])
    commandMocks.listRemotes.mockResolvedValue([])
    commandMocks.listTags.mockResolvedValue([])
    commandMocks.stashList.mockResolvedValue([])
    commandMocks.listSubmodules.mockResolvedValue([])
    commandMocks.getFileDiff.mockResolvedValue(fileDiff('src/a.ts'))
  })

  it('reloads the active repository domains and refreshes the current WIP diff', async () => {
    const diffStore = useDiffStore()
    diffStore.currentPath = 'src/a.ts'
    diffStore.currentStaged = false

    await useRepositoryRefresh().refreshActiveRepository()

    expect(commandMocks.getStatus).toHaveBeenCalledWith('repo-a')
    expect(commandMocks.getLog).toHaveBeenCalled()
    expect(commandMocks.listBranches).toHaveBeenCalledWith('repo-a')
    expect(commandMocks.listTags).toHaveBeenCalledWith('repo-a')
    expect(commandMocks.stashList).toHaveBeenCalledWith('repo-a')
    expect(commandMocks.listSubmodules).toHaveBeenCalledWith('repo-a')
    expect(commandMocks.getFileDiff).toHaveBeenCalledWith('repo-a', 'src/a.ts', false)
    expect(diffStore.currentDiff?.new_path).toBe('src/a.ts')
    expect(useRepoOpsStore().getBusy('repo-a').refresh).toBe(false)
  })

  it('clears the current WIP diff when the selected file disappears', async () => {
    commandMocks.getStatus.mockResolvedValue(statusWith({}))
    const diffStore = useDiffStore()
    diffStore.currentPath = 'src/a.ts'
    diffStore.currentStaged = false
    diffStore.currentDiff = fileDiff('src/a.ts')

    await useRepositoryRefresh().refreshActiveRepository()

    expect(commandMocks.getFileDiff).not.toHaveBeenCalled()
    expect(diffStore.currentPath).toBeNull()
    expect(diffStore.currentDiff).toBeNull()
  })

  it('keeps the selected path when its staged side changes during refresh', async () => {
    commandMocks.getStatus.mockResolvedValue(
      statusWith({ staged: [modifiedFile('src/a.ts', true)] }),
    )
    const diffStore = useDiffStore()
    diffStore.currentPath = 'src/a.ts'
    diffStore.currentStaged = false

    await useRepositoryRefresh().refreshActiveRepository()

    expect(commandMocks.getFileDiff).toHaveBeenCalledWith('repo-a', 'src/a.ts', true)
    expect(diffStore.currentStaged).toBe(true)
  })
})
