import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConflictFile, FileEntry } from '@/types/git'
import { useWipMenus } from './useWipMenus'

const toastMocks = vi.hoisted(() => ({
  showActionError: vi.fn(),
  showToast: vi.fn(),
  writeText: vi.fn(),
}))

vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showActionError: toastMocks.showActionError,
    showToast: toastMocks.showToast,
  }),
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
    openFileInEditor: vi.fn(),
  }
  const mergeRebase = {
    loadConflictFile: vi.fn().mockResolvedValue(conflict),
    resolveConflict: vi.fn().mockResolvedValue(undefined),
    useConflictSide: vi.fn().mockResolvedValue(undefined),
  }
  const unstagedMultiPaths = ref<string[]>([])
  const stagedMultiPaths = ref<string[]>([])
  const batchStage = vi.fn().mockResolvedValue(undefined)
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
    unstagedMultiPaths,
    stagedMultiPaths,
    toggleFile: vi.fn(),
    batchStage,
    batchUnstage: vi.fn(),
    batchDiscard: vi.fn(),
    orderedBatchPaths: vi.fn((source: 'unstaged' | 'staged') =>
      source === 'unstaged' ? [...unstagedMultiPaths.value] : [...stagedMultiPaths.value]
    ),
    moveFileOrder: vi.fn(),
    requestDiscardFile: vi.fn(),
    openSubmodule: vi.fn(),
    initSubmodule: vi.fn(),
    updateSubmodule: vi.fn(),
    showFileHistory: vi.fn(),
  } as unknown as Parameters<typeof useWipMenus>[0]
  return {
    menu: useWipMenus(options),
    repo,
    git,
    mergeRebase,
    unstagedMultiPaths,
    batchStage,
  }
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
    toastMocks.showToast.mockReset()
    toastMocks.writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: toastMocks.writeText },
    })
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

  it('copies a workspace path through the shared feedback channel', async () => {
    const { menu } = createMenu()
    menu.openFileContextMenu(new MouseEvent('contextmenu'), {
      file: {
        path: 'src/main.ts',
        status: 'modified',
        staged: false,
        additions: 1,
        deletions: 0,
      },
      path: 'src/main.ts',
      isDir: false,
    })

    await menu.handleFileMenuAction('copy-relative')

    expect(toastMocks.writeText).toHaveBeenCalledWith('src/main.ts')
    expect(toastMocks.showToast).toHaveBeenCalledWith('success', 'clipboard.copySuccess')
  })

  it('cancels regular file actions after switching repositories', async () => {
    const { menu, repo, git } = createMenu()
    menu.openFileContextMenu(new MouseEvent('contextmenu'), {
      file: {
        path: 'src/main.ts',
        status: 'modified',
        staged: false,
        additions: 1,
        deletions: 0,
      },
      path: 'src/main.ts',
      isDir: false,
    })
    repo.activeRepoId = 'repo-2'

    await menu.handleFileMenuAction('open-editor')

    expect(git.openFileInEditor).not.toHaveBeenCalled()
    expect(toastMocks.showActionError).toHaveBeenCalledOnce()
  })

  it('uses the batch path snapshot captured when the menu opened', async () => {
    const { menu, unstagedMultiPaths, batchStage } = createMenu()
    unstagedMultiPaths.value = ['src/a.ts', 'src/b.ts']
    menu.openFileContextMenu(new MouseEvent('contextmenu'), {
      file: {
        path: 'src/a.ts',
        status: 'modified',
        staged: false,
        additions: 1,
        deletions: 0,
      },
      path: 'src/a.ts',
      isDir: false,
    })
    unstagedMultiPaths.value = ['src/c.ts']

    await menu.handleBatchMenuAction('batch-stage')

    expect(batchStage).toHaveBeenCalledWith(['src/a.ts', 'src/b.ts'])
  })

  it('cancels batch actions after switching repositories', async () => {
    const { menu, repo, unstagedMultiPaths, batchStage } = createMenu()
    unstagedMultiPaths.value = ['src/a.ts', 'src/b.ts']
    menu.openFileContextMenu(new MouseEvent('contextmenu'), {
      file: {
        path: 'src/a.ts',
        status: 'modified',
        staged: false,
        additions: 1,
        deletions: 0,
      },
      path: 'src/a.ts',
      isDir: false,
    })
    repo.activeRepoId = 'repo-2'

    await menu.handleBatchMenuAction('batch-stage')

    expect(batchStage).not.toHaveBeenCalled()
    expect(toastMocks.showActionError).toHaveBeenCalledOnce()
  })
})
