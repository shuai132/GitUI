import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStatus } from '@/types/git'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ContextMenu from '@/components/common/ContextMenu.vue'
import SidebarStash from './SidebarStash.vue'

const mocks = vi.hoisted(() => ({
  repo: { activeRepoId: 'repo-a' as string | null },
  stash: {
    entries: [{ index: 2, message: 'work in progress', commit_oid: 'stash-oid' }],
    apply: vi.fn(),
    pop: vi.fn(),
    drop: vi.fn(),
  },
  workspace: { status: null as WorkspaceStatus | null },
  history: { pendingJumpOid: null as string | null },
  routerPush: vi.fn(),
  showError: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'sidebar.stash.confirmPop') {
        return `pop ${params?.index} ${params?.message} ${params?.count}`
      }
      if (key === 'sidebar.stash.confirmDrop') {
        return `drop ${params?.index} ${params?.message}`
      }
      return key
    },
  }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}))

vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('@/stores/stash', () => ({ useStashStore: () => mocks.stash }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => mocks.workspace }))
vi.mock('@/stores/history', () => ({ useHistoryStore: () => mocks.history }))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showError: mocks.showError,
    showActionError: (error: unknown, fallback?: string) =>
      mocks.showError(fallback ?? String(error)),
  }),
}))
vi.mock('@/composables/useSidebarSectionState', () => ({
  useSidebarSectionState: () => ({
    isCollapsed: () => false,
    toggle: vi.fn(),
  }),
}))

function workspaceStatus(paths: string[] = []): WorkspaceStatus {
  return {
    staged: paths.slice(0, 1).map((path) => ({
      path,
      status: 'modified',
      staged: true,
      additions: 1,
      deletions: 0,
    })),
    unstaged: paths.map((path) => ({
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

async function selectMenuAction(action: 'apply' | 'pop' | 'delete') {
  const wrapper = shallowMount(SidebarStash)
  await wrapper.find('.stash-item').trigger('contextmenu')
  wrapper.findComponent(ContextMenu).vm.$emit('select', action)
  await flushPromises()
  return wrapper
}

describe('SidebarStash', () => {
  beforeEach(() => {
    mocks.repo.activeRepoId = 'repo-a'
    mocks.workspace.status = workspaceStatus()
    mocks.stash.apply.mockReset().mockResolvedValue(undefined)
    mocks.stash.pop.mockReset().mockResolvedValue(undefined)
    mocks.stash.drop.mockReset().mockResolvedValue(undefined)
    mocks.showError.mockReset()
  })

  it('applies the selected stash in the captured repository with an OID guard', async () => {
    await selectMenuAction('apply')

    expect(mocks.stash.apply).toHaveBeenCalledWith('repo-a', 2, 'stash-oid')
  })

  it('pops immediately on a clean worktree and guards the selected stash OID', async () => {
    await selectMenuAction('pop')

    expect(mocks.stash.pop).toHaveBeenCalledWith('repo-a', 2, 'stash-oid')
  })

  it('confirms before popping into local changes and counts unique paths', async () => {
    mocks.workspace.status = workspaceStatus(['one.txt', 'two.txt'])
    const wrapper = await selectMenuAction('pop')

    expect(mocks.stash.pop).not.toHaveBeenCalled()
    const dialog = wrapper.findComponent(ConfirmDialog)
    expect(dialog.props()).toMatchObject({
      visible: true,
      danger: false,
      message: 'pop 2 work in progress 2',
    })

    dialog.vm.$emit('confirm')
    await flushPromises()
    expect(mocks.stash.pop).toHaveBeenCalledWith('repo-a', 2, 'stash-oid')
  })

  it('uses a dangerous app confirmation before dropping the selected stash', async () => {
    const wrapper = await selectMenuAction('delete')
    const dialog = wrapper.findComponent(ConfirmDialog)

    expect(dialog.props()).toMatchObject({
      visible: true,
      danger: true,
      message: 'drop 2 work in progress',
    })

    dialog.vm.$emit('confirm')
    await flushPromises()
    expect(mocks.stash.drop).toHaveBeenCalledWith('repo-a', 2, 'stash-oid')
  })

  it('cancels a pending action after the active repository changes', async () => {
    mocks.workspace.status = workspaceStatus(['one.txt'])
    const wrapper = await selectMenuAction('pop')
    mocks.repo.activeRepoId = 'repo-b'

    wrapper.findComponent(ConfirmDialog).vm.$emit('confirm')
    await flushPromises()

    expect(mocks.stash.pop).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalledWith('sidebar.stash.contextChanged')
  })
})
