import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BranchInfo } from '@/types/git'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ContextMenu from '@/components/common/ContextMenu.vue'
import BranchTreeNode from './BranchTreeNode.vue'
import SidebarRemote from './SidebarRemote.vue'

const remoteBranch: BranchInfo = {
  name: 'origin/feature',
  is_remote: true,
  is_head: false,
  commit_oid: '2222222222222222222222222222222222222222',
}

const mocks = vi.hoisted(() => ({
  repo: { activeRepoId: 'repo-a' as string | null },
  history: {
    branches: [] as BranchInfo[],
    remotes: [{ name: 'origin', url: '/remote' }],
    pendingJumpOid: null as string | null,
    deleteRemoteBranch: vi.fn(),
    loadBranches: vi.fn(),
  },
  ui: { requestFetch: vi.fn() },
  git: { removeRemote: vi.fn() },
  showError: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      `${key} ${Object.values(params ?? {}).join(' ')}`.trim(),
  }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('@/stores/history', () => ({ useHistoryStore: () => mocks.history }))
vi.mock('@/stores/ui', () => ({ useUiStore: () => mocks.ui }))
vi.mock('@/composables/useGitCommands', () => ({ useGitCommands: () => mocks.git }))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showError: mocks.showError,
    showActionError: (error: unknown, fallback?: string) =>
      mocks.showError(fallback ?? String(error)),
  }),
}))
vi.mock('@/composables/useSidebarSectionState', () => ({
  useSidebarSectionState: () => ({ isCollapsed: () => false, toggle: vi.fn() }),
}))

describe('SidebarRemote guarded deletion', () => {
  beforeEach(() => {
    mocks.repo.activeRepoId = 'repo-a'
    mocks.history.branches = [{ ...remoteBranch }]
    mocks.history.remotes = [{ name: 'origin', url: '/remote' }]
    mocks.history.deleteRemoteBranch.mockReset().mockResolvedValue(undefined)
    mocks.history.loadBranches.mockReset().mockResolvedValue(undefined)
    mocks.git.removeRemote.mockReset().mockResolvedValue(undefined)
    mocks.showError.mockReset()
  })

  async function requestRemoteRemoval() {
    const wrapper = shallowMount(SidebarRemote)
    wrapper.findComponent(BranchTreeNode).vm.$emit('delete-remote', 'origin')
    await flushPromises()
    return wrapper
  }

  it('previews the Remote URL and tracking ref count before exact deletion', async () => {
    const wrapper = await requestRemoteRemoval()
    const dialog = wrapper.findComponent(ConfirmDialog)

    expect(dialog.props('message')).toContain('/remote')
    expect(dialog.props('message')).toContain('1')
    dialog.vm.$emit('confirm')
    await flushPromises()

    expect(mocks.git.removeRemote).toHaveBeenCalledWith(
      'repo-a',
      'origin',
      '/remote',
    )
    expect(mocks.history.loadBranches).toHaveBeenCalled()
  })

  it('cancels removal after the Remote URL changes', async () => {
    const wrapper = await requestRemoteRemoval()
    mocks.history.remotes = [{ name: 'origin', url: '/replacement' }]

    wrapper.findComponent(ConfirmDialog).vm.$emit('confirm')
    await flushPromises()

    expect(mocks.git.removeRemote).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalled()
  })

  it('cancels removal after the tracking refs change', async () => {
    const wrapper = await requestRemoteRemoval()
    mocks.history.branches = [{
      ...remoteBranch,
      commit_oid: '3333333333333333333333333333333333333333',
    }]

    wrapper.findComponent(ConfirmDialog).vm.$emit('confirm')
    await flushPromises()

    expect(mocks.git.removeRemote).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalled()
  })

  it('cancels removal after the active repository changes', async () => {
    const wrapper = await requestRemoteRemoval()
    mocks.repo.activeRepoId = 'repo-b'

    wrapper.findComponent(ConfirmDialog).vm.$emit('confirm')
    await flushPromises()

    expect(mocks.git.removeRemote).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalled()
  })

  it('deletes the exact remote branch target shown in confirmation', async () => {
    const wrapper = shallowMount(SidebarRemote)
    wrapper.findComponent(BranchTreeNode).vm.$emit(
      'branch-context-menu',
      new MouseEvent('contextmenu'),
      remoteBranch,
    )
    await flushPromises()
    const branchMenu = wrapper.findAllComponents(ContextMenu)[1]
    branchMenu.vm.$emit('select', 'delete')
    await flushPromises()
    const dialog = wrapper.findComponent(ConfirmDialog)

    expect(dialog.props('message')).toContain('2222222')
    dialog.vm.$emit('confirm')
    await flushPromises()

    expect(mocks.history.deleteRemoteBranch).toHaveBeenCalledWith(
      'origin',
      'feature',
      remoteBranch.commit_oid,
    )
  })
})
