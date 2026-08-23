import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileDiff } from '@/types/git'
import { useRevertHunk } from './useRevertHunk'
import { useWipHunkAction } from './useWipHunkAction'

const mocks = vi.hoisted(() => ({
  git: {
    applyPatch: vi.fn(),
    applyPatchToIndex: vi.fn(),
    applyPatchToWorkdirAndIndex: vi.fn(),
    stageFile: vi.fn(),
    unstageFile: vi.fn(),
  },
  workspace: {
    status: null,
    refresh: vi.fn(),
  },
  diff: {
    currentPath: null as string | null,
    currentStaged: false,
    clear: vi.fn(),
    refresh: vi.fn(),
  },
  showActionError: vi.fn(),
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => mocks.git,
}))
vi.mock('@/stores/workspace', () => ({
  useWorkspaceStore: () => mocks.workspace,
}))
vi.mock('@/stores/diff', () => ({ useDiffStore: () => mocks.diff }))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({ showActionError: mocks.showActionError }),
}))

const diff: FileDiff = {
  old_path: 'demo.txt',
  new_path: 'demo.txt',
  is_binary: false,
  additions: 1,
  deletions: 1,
  encoding: 'UTF-8',
  hunks: [{
    old_start: 1,
    old_lines: 1,
    new_start: 1,
    new_lines: 1,
    header: '@@ -1 +1 @@',
    lines: [
      { origin: '-', content: 'old\n', old_lineno: 1 },
      { origin: '+', content: 'new\n', new_lineno: 1 },
    ],
  }],
}

describe('hunk action failure feedback', () => {
  beforeEach(() => {
    for (const command of Object.values(mocks.git)) command.mockReset()
    mocks.workspace.refresh.mockReset().mockResolvedValue(undefined)
    mocks.diff.refresh.mockReset().mockResolvedValue(undefined)
    mocks.showActionError.mockReset()
  })

  it('reports a WIP hunk staging failure', async () => {
    const error = new Error('index locked')
    mocks.git.applyPatchToIndex.mockRejectedValue(error)
    const { applyWipHunk } = useWipHunkAction({
      repoId: 'repo-a',
      diff,
      wip: { staged: false, status: 'modified' },
    })

    await applyWipHunk(0)

    expect(mocks.showActionError).toHaveBeenCalledWith(error)
  })

  it('reports a WIP hunk discard failure', async () => {
    const error = new Error('patch no longer applies')
    mocks.git.applyPatch.mockRejectedValue(error)
    const { discardWipHunk } = useWipHunkAction({
      repoId: 'repo-a',
      diff,
      wip: { staged: false, status: 'modified' },
    })

    await discardWipHunk(0)

    expect(mocks.showActionError).toHaveBeenCalledWith(error)
  })

  it('reports a committed hunk revert failure', async () => {
    const error = new Error('worktree changed')
    mocks.git.applyPatch.mockRejectedValue(error)
    const { revertHunk } = useRevertHunk({
      repoId: 'repo-a',
      diff,
      wip: null,
    })

    await revertHunk(0)

    expect(mocks.showActionError).toHaveBeenCalledWith(error)
  })
})
