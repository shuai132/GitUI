import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConflictFile, FileEntry } from '@/types/git'
import { useWipMenus } from './useWipMenus'

const toastMocks = vi.hoisted(() => ({
  showActionError: vi.fn(),
}))

vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({ showActionError: toastMocks.showActionError }),
}))

const conflictedFile: FileEntry = {
  path: 'conflict.txt',
  status: 'conflicted',
  staged: false,
  additions: 1,
  deletions: 1,
}

const conflict: ConflictFile = {
  path: 'conflict.txt',
  context_id: 'conflict-context',
  ours: 'ours',
  theirs: 'theirs',
  merged_preview: '',
  is_binary: false,
}

function createMenu() {
  const repo = {
    activeRepoId: 'repo-1' as string | null,
    activeRepo: () => ({ id: 'repo-1', name: 'one', path: '/repo-one' }),
  }
  const git = {
    readWorktreeFile: vi.fn(),
  }
  const mergeRebase = {
    loadConflictFile: vi.fn().mockResolvedValue(conflict),
    resolveConflict: vi.fn().mockResolvedValue(undefined),
    useConflictSide: vi.fn().mockResolvedValue(undefined),
  }
  const options = {
    t: (key: string) => key,
    git,
    mergeRebaseStore: mergeRebase,
    repoStore: repo,
    settingsStore: {},
    workspaceStore: { refresh: vi.fn() },
    submodules: computed(() => []),
    viewMode: ref<'list' | 'tree'>('list'),
    selectedPath: ref<string | null>(null),
    unstagedMultiPaths: ref<string[]>([]),
    stagedMultiPaths: ref<string[]>([]),
    toggleFile: vi.fn(),
    batchStage: vi.fn(),
    batchUnstage: vi.fn(),
    batchDiscard: vi.fn(),
    orderedBatchPaths: vi.fn(() => []),
    moveFileOrder: vi.fn(),
    requestDiscardFile: vi.fn(),
    openSubmodule: vi.fn(),
    initSubmodule: vi.fn(),
    updateSubmodule: vi.fn(),
    showFileHistory: vi.fn(),
  } as unknown as Parameters<typeof useWipMenus>[0]
  return { menu: useWipMenus(options), repo, git, mergeRebase }
}

function openConflictMenu(menu: ReturnType<typeof useWipMenus>) {
  menu.openFileContextMenu(new MouseEvent('contextmenu'), {
    file: conflictedFile,
    path: conflictedFile.path,
    isDir: false,
  })
}

describe('useWipMenus conflict context', () => {
  beforeEach(() => {
    toastMocks.showActionError.mockReset()
  })

  it('cancels a conflict action after switching repositories', async () => {
    const { menu, repo, mergeRebase } = createMenu()
    openConflictMenu(menu)
    repo.activeRepoId = 'repo-2'

    await menu.handleFileMenuAction('use-ours')

    expect(mergeRebase.loadConflictFile).not.toHaveBeenCalled()
    expect(mergeRebase.useConflictSide).not.toHaveBeenCalled()
    expect(toastMocks.showActionError).toHaveBeenCalledOnce()
  })

  it('does not stage empty content when reading the worktree file fails', async () => {
    const { menu, git, mergeRebase } = createMenu()
    git.readWorktreeFile.mockRejectedValue(new Error('read failed'))
    openConflictMenu(menu)

    await menu.handleFileMenuAction('mark-resolved')

    expect(mergeRebase.loadConflictFile).toHaveBeenCalledWith('repo-1', 'conflict.txt')
    expect(mergeRebase.resolveConflict).not.toHaveBeenCalled()
    expect(toastMocks.showActionError).toHaveBeenCalledOnce()
  })
})
