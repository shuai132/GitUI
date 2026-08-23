import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileDiff } from '@/types/git'
import { useCommitFileMenu } from './useCommitFileMenu'

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

function fileDiff(path: string): FileDiff {
  return {
    old_path: path,
    new_path: path,
    is_binary: false,
    hunks: [],
    additions: 1,
    deletions: 0,
    old_blob_oid: 'old-blob',
    new_blob_oid: 'new-blob',
    encoding: 'UTF-8',
  }
}

function createMenu() {
  const repo = {
    activeRepoId: 'repo-1' as string | null,
    activeRepo: () => ({ id: 'repo-1', name: 'one', path: '/repo-one' }),
  }
  const diffs = ref<FileDiff[]>([fileDiff('src/original.ts')])
  const commitOid = ref<string | undefined>('commit-one')
  const git = {
    checkoutFileAtCommit: vi.fn().mockResolvedValue(undefined),
    openFileInEditor: vi.fn().mockResolvedValue(undefined),
  }
  const workspace = { refresh: vi.fn().mockResolvedValue(undefined) }
  const options = {
    t: (key: string) => key,
    git,
    repoStore: repo,
    workspaceStore: workspace,
    submodules: computed(() => []),
    diffs,
    commitOid,
    openSubmodule: vi.fn(),
    initSubmodule: vi.fn(),
    updateSubmodule: vi.fn(),
    moveFileOrder: vi.fn(),
    showFileHistory: vi.fn(),
  } as unknown as Parameters<typeof useCommitFileMenu>[0]
  return {
    menu: useCommitFileMenu(options),
    repo,
    diffs,
    commitOid,
    git,
    workspace,
  }
}

function openFirstFile(menu: ReturnType<typeof useCommitFileMenu>) {
  menu.openFileMenu(new MouseEvent('contextmenu'), 0)
}

describe('useCommitFileMenu target context', () => {
  beforeEach(() => {
    toastMocks.showActionError.mockReset()
    toastMocks.showToast.mockReset()
    toastMocks.writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: toastMocks.writeText },
    })
  })

  it('checks out the commit and file captured when the menu opened', async () => {
    const { menu, diffs, commitOid, git, workspace } = createMenu()
    openFirstFile(menu)
    diffs.value = [fileDiff('src/replacement.ts')]
    commitOid.value = 'commit-two'

    await menu.handleFileMenuAction('checkout-file')

    expect(git.checkoutFileAtCommit).toHaveBeenCalledWith(
      'repo-1',
      'commit-one',
      'src/original.ts',
    )
    expect(workspace.refresh).toHaveBeenCalledWith('repo-1')
  })

  it('cancels file actions after switching repositories', async () => {
    const { menu, repo, git } = createMenu()
    openFirstFile(menu)
    repo.activeRepoId = 'repo-2'

    await menu.handleFileMenuAction('open-editor')

    expect(git.openFileInEditor).not.toHaveBeenCalled()
    expect(toastMocks.showActionError).toHaveBeenCalledOnce()
  })
})
