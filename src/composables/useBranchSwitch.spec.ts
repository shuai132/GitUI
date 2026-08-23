import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BranchInfo, WorkspaceStatus } from '@/types/git'
import { useBranchSwitch } from './useBranchSwitch'

const mocks = vi.hoisted(() => ({
  history: {
    branches: [] as BranchInfo[],
    switchBranchInRepo: vi.fn(),
  },
  workspace: {
    status: null as WorkspaceStatus | null,
    refresh: vi.fn(),
    discardAll: vi.fn(),
  },
  stash: {
    push: vi.fn(),
  },
  repo: { activeRepoId: 'repo-a' as string | null },
}))

vi.mock('@/stores/history', () => ({
  useHistoryStore: () => mocks.history,
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspaceStore: () => mocks.workspace,
}))

vi.mock('@/stores/stash', () => ({
  useStashStore: () => mocks.stash,
}))

vi.mock('@/stores/repos', () => ({
  useRepoStore: () => mocks.repo,
}))

vi.mock('@/i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params?.detail ? `${key}: ${String(params.detail)}` : key,
}))

function workspaceStatus(changedPaths: string[] = []): WorkspaceStatus {
  return {
    staged: changedPaths.slice(0, 1).map((path) => ({
      path,
      status: 'modified',
      staged: true,
      additions: 1,
      deletions: 0,
    })),
    unstaged: changedPaths.slice(1).map((path) => ({
      path,
      status: 'modified',
      staged: false,
      additions: 1,
      deletions: 0,
    })),
    untracked: [],
    head_branch: 'main',
    head_commit: 'head',
    head_commit_message: 'head',
    is_detached: false,
    repo_state: { kind: 'clean' },
  }
}

describe('branch switch flow', () => {
  beforeEach(() => {
    mocks.repo.activeRepoId = 'repo-a'
    mocks.history.branches = [{
      name: 'feature',
      is_remote: false,
      is_head: false,
      commit_oid: 'target',
    }]
    mocks.history.switchBranchInRepo.mockReset()
    mocks.workspace.refresh.mockReset()
    mocks.workspace.discardAll.mockReset()
    mocks.stash.push.mockReset()
    mocks.workspace.status = workspaceStatus()
  })

  it('switches a clean worktree immediately and refreshes workspace', async () => {
    mocks.history.switchBranchInRepo.mockResolvedValue(undefined)
    mocks.workspace.refresh.mockResolvedValue(undefined)
    const flow = useBranchSwitch()

    await flow.requestSwitch('feature')

    expect(flow.dialogVisible.value).toBe(false)
    expect(mocks.history.switchBranchInRepo).toHaveBeenCalledWith('repo-a', 'feature')
    expect(mocks.workspace.refresh).toHaveBeenCalledTimes(1)
  })

  it('can switch from a detached HEAD while guarding its actual head context', async () => {
    mocks.workspace.status = {
      ...workspaceStatus(),
      head_branch: undefined,
      is_detached: true,
    }
    mocks.history.switchBranchInRepo.mockResolvedValue(undefined)
    mocks.workspace.refresh.mockResolvedValue(undefined)
    const flow = useBranchSwitch()

    await flow.requestSwitch('feature')

    expect(mocks.history.switchBranchInRepo).toHaveBeenCalledWith('repo-a', 'feature')
  })

  it('prompts for a dirty worktree and can carry changes', async () => {
    mocks.workspace.status = workspaceStatus(['one.txt', 'two.txt'])
    mocks.history.switchBranchInRepo.mockResolvedValue(undefined)
    mocks.workspace.refresh.mockResolvedValue(undefined)
    const flow = useBranchSwitch()

    await flow.requestSwitch('feature')

    expect(flow.dialogVisible.value).toBe(true)
    expect(flow.changeCount.value).toBe(2)
    expect(mocks.history.switchBranchInRepo).not.toHaveBeenCalled()

    await flow.confirmSwitch('carry')

    expect(mocks.stash.push).not.toHaveBeenCalled()
    expect(mocks.history.switchBranchInRepo).toHaveBeenCalledWith('repo-a', 'feature')
    expect(flow.dialogVisible.value).toBe(false)
  })

  it('rejects a pending switch after the repository or workspace paths change', async () => {
    mocks.workspace.status = workspaceStatus(['one.txt'])
    const flow = useBranchSwitch()
    await flow.requestSwitch('feature')
    mocks.workspace.status = workspaceStatus(['one.txt', 'new.txt'])

    await flow.confirmSwitch('discard')

    expect(mocks.workspace.discardAll).not.toHaveBeenCalled()
    expect(mocks.history.switchBranchInRepo).not.toHaveBeenCalled()
    expect(flow.error.value).toBe('sidebar.branch.switchDialog.contextChanged')

    mocks.workspace.status = workspaceStatus(['one.txt'])
    mocks.repo.activeRepoId = 'repo-b'
    await flow.confirmSwitch('stash')

    expect(mocks.stash.push).not.toHaveBeenCalled()
  })

  it('rejects a pending switch after the target branch moves', async () => {
    mocks.workspace.status = workspaceStatus(['one.txt'])
    const flow = useBranchSwitch()
    await flow.requestSwitch('feature')
    mocks.history.branches[0] = {
      ...mocks.history.branches[0],
      commit_oid: 'moved-target',
    }

    await flow.confirmSwitch('carry')

    expect(mocks.history.switchBranchInRepo).not.toHaveBeenCalled()
    expect(flow.error.value).toBe('sidebar.branch.switchDialog.contextChanged')
  })

  it('keeps the dialog actionable after carrying changes fails', async () => {
    mocks.workspace.status = workspaceStatus(['one.txt'])
    mocks.history.switchBranchInRepo.mockRejectedValueOnce(new Error('checkout conflict'))
    mocks.stash.push.mockResolvedValue(undefined)
    mocks.history.switchBranchInRepo.mockResolvedValueOnce(undefined)
    mocks.workspace.refresh.mockResolvedValue(undefined)
    const flow = useBranchSwitch()
    await flow.requestSwitch('feature')

    await flow.confirmSwitch('carry')

    expect(flow.dialogVisible.value).toBe(true)
    expect(flow.error.value).toContain('checkout conflict')

    await flow.confirmSwitch('stash')

    expect(mocks.stash.push).toHaveBeenCalledTimes(1)
    expect(mocks.history.switchBranchInRepo).toHaveBeenCalledTimes(2)
    expect(flow.dialogVisible.value).toBe(false)
  })

  it('retains a successful stash when switching fails and retries without stashing twice', async () => {
    mocks.workspace.status = workspaceStatus(['one.txt'])
    mocks.stash.push.mockResolvedValue(undefined)
    mocks.history.switchBranchInRepo
      .mockRejectedValueOnce(new Error('branch locked'))
      .mockResolvedValueOnce(undefined)
    mocks.workspace.refresh.mockResolvedValue(undefined)
    const flow = useBranchSwitch()
    await flow.requestSwitch('feature')

    await flow.confirmSwitch('stash')

    expect(flow.dialogVisible.value).toBe(true)
    expect(flow.changesStashed.value).toBe(true)
    expect(mocks.stash.push).toHaveBeenCalledWith(
      'sidebar.branch.switchDialog.stashMessage',
      'repo-a',
    )
    expect(flow.error.value).toContain('branch locked')

    await flow.confirmSwitch('carry')

    expect(mocks.stash.push).toHaveBeenCalledTimes(1)
    expect(mocks.history.switchBranchInRepo).toHaveBeenCalledTimes(2)
    expect(flow.dialogVisible.value).toBe(false)
  })

  it('discards changes through the recoverable workspace flow before switching safely', async () => {
    mocks.workspace.status = workspaceStatus(['one.txt', 'two.txt'])
    mocks.workspace.discardAll.mockResolvedValue(undefined)
    mocks.history.switchBranchInRepo.mockResolvedValue(undefined)
    mocks.workspace.refresh.mockResolvedValue(undefined)
    const flow = useBranchSwitch()
    await flow.requestSwitch('feature')

    await flow.confirmSwitch('discard')

    expect(mocks.workspace.discardAll).toHaveBeenCalledTimes(1)
    expect(mocks.workspace.discardAll).toHaveBeenCalledWith(
      'repo-a',
      'head',
      ['one.txt', 'two.txt'],
    )
    expect(mocks.history.switchBranchInRepo).toHaveBeenCalledWith('repo-a', 'feature')
    expect(flow.dialogVisible.value).toBe(false)
  })

  it('does not switch when recoverable discard fails', async () => {
    mocks.workspace.status = workspaceStatus(['one.txt'])
    mocks.workspace.discardAll.mockRejectedValue(new Error('Trash unavailable'))
    const flow = useBranchSwitch()
    await flow.requestSwitch('feature')

    await flow.confirmSwitch('discard')

    expect(mocks.history.switchBranchInRepo).not.toHaveBeenCalled()
    expect(flow.changesDiscarded.value).toBe(false)
    expect(flow.error.value).toContain('Trash unavailable')
    expect(flow.dialogVisible.value).toBe(true)
  })

  it('retries switching without discarding twice after the worktree was restored', async () => {
    mocks.workspace.status = workspaceStatus(['one.txt'])
    mocks.workspace.discardAll.mockResolvedValue(undefined)
    mocks.history.switchBranchInRepo
      .mockRejectedValueOnce(new Error('ignored file conflict'))
      .mockResolvedValueOnce(undefined)
    mocks.workspace.refresh.mockResolvedValue(undefined)
    const flow = useBranchSwitch()
    await flow.requestSwitch('feature')

    await flow.confirmSwitch('discard')

    expect(flow.changesDiscarded.value).toBe(true)
    expect(flow.error.value).toContain('ignored file conflict')

    await flow.confirmSwitch('carry')

    expect(mocks.workspace.discardAll).toHaveBeenCalledTimes(1)
    expect(mocks.history.switchBranchInRepo).toHaveBeenCalledTimes(2)
    expect(flow.dialogVisible.value).toBe(false)
  })
})
