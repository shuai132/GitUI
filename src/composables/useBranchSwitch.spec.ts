import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStatus } from '@/types/git'
import { useBranchSwitch } from './useBranchSwitch'

const mocks = vi.hoisted(() => ({
  history: {
    switchBranch: vi.fn(),
  },
  workspace: {
    status: null as WorkspaceStatus | null,
    refresh: vi.fn(),
  },
  stash: {
    push: vi.fn(),
  },
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
    mocks.history.switchBranch.mockReset()
    mocks.workspace.refresh.mockReset()
    mocks.stash.push.mockReset()
    mocks.workspace.status = workspaceStatus()
  })

  it('switches a clean worktree immediately and refreshes workspace', async () => {
    mocks.history.switchBranch.mockResolvedValue(undefined)
    mocks.workspace.refresh.mockResolvedValue(undefined)
    const flow = useBranchSwitch()

    await flow.requestSwitch('feature')

    expect(flow.dialogVisible.value).toBe(false)
    expect(mocks.history.switchBranch).toHaveBeenCalledWith('feature')
    expect(mocks.workspace.refresh).toHaveBeenCalledTimes(1)
  })

  it('prompts for a dirty worktree and can carry changes', async () => {
    mocks.workspace.status = workspaceStatus(['one.txt', 'two.txt'])
    mocks.history.switchBranch.mockResolvedValue(undefined)
    mocks.workspace.refresh.mockResolvedValue(undefined)
    const flow = useBranchSwitch()

    await flow.requestSwitch('feature')

    expect(flow.dialogVisible.value).toBe(true)
    expect(flow.changeCount.value).toBe(2)
    expect(mocks.history.switchBranch).not.toHaveBeenCalled()

    await flow.confirmSwitch('carry')

    expect(mocks.stash.push).not.toHaveBeenCalled()
    expect(mocks.history.switchBranch).toHaveBeenCalledWith('feature')
    expect(flow.dialogVisible.value).toBe(false)
  })

  it('keeps the dialog actionable after carrying changes fails', async () => {
    mocks.workspace.status = workspaceStatus(['one.txt'])
    mocks.history.switchBranch.mockRejectedValueOnce(new Error('checkout conflict'))
    mocks.stash.push.mockResolvedValue(undefined)
    mocks.history.switchBranch.mockResolvedValueOnce(undefined)
    mocks.workspace.refresh.mockResolvedValue(undefined)
    const flow = useBranchSwitch()
    await flow.requestSwitch('feature')

    await flow.confirmSwitch('carry')

    expect(flow.dialogVisible.value).toBe(true)
    expect(flow.error.value).toContain('checkout conflict')

    await flow.confirmSwitch('stash')

    expect(mocks.stash.push).toHaveBeenCalledTimes(1)
    expect(mocks.history.switchBranch).toHaveBeenCalledTimes(2)
    expect(flow.dialogVisible.value).toBe(false)
  })

  it('retains a successful stash when switching fails and retries without stashing twice', async () => {
    mocks.workspace.status = workspaceStatus(['one.txt'])
    mocks.stash.push.mockResolvedValue(undefined)
    mocks.history.switchBranch
      .mockRejectedValueOnce(new Error('branch locked'))
      .mockResolvedValueOnce(undefined)
    mocks.workspace.refresh.mockResolvedValue(undefined)
    const flow = useBranchSwitch()
    await flow.requestSwitch('feature')

    await flow.confirmSwitch('stash')

    expect(flow.dialogVisible.value).toBe(true)
    expect(flow.changesStashed.value).toBe(true)
    expect(flow.error.value).toContain('branch locked')

    await flow.confirmSwitch('carry')

    expect(mocks.stash.push).toHaveBeenCalledTimes(1)
    expect(mocks.history.switchBranch).toHaveBeenCalledTimes(2)
    expect(flow.dialogVisible.value).toBe(false)
  })
})
