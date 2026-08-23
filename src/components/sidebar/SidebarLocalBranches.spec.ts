import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BranchInfo } from '@/types/git'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ContextMenu from '@/components/common/ContextMenu.vue'
import BranchTreeNode from './BranchTreeNode.vue'
import SidebarLocalBranches from './SidebarLocalBranches.vue'

const localBranch: BranchInfo = {
  name: 'feature',
  is_remote: false,
  is_head: false,
  upstream: 'origin/feature',
  commit_oid: '1111111111111111111111111111111111111111',
}

const remoteBranch: BranchInfo = {
  name: 'origin/feature',
  is_remote: true,
  is_head: false,
  commit_oid: '2222222222222222222222222222222222222222',
}

const mocks = vi.hoisted(() => ({
  repo: {
    activeRepoId: 'repo-a' as string | null,
    activeRepo: () => ({ path: '/repo-a' }),
  },
  history: {
    branches: [] as BranchInfo[],
    pendingJumpOid: null as string | null,
    deleteBranch: vi.fn(),
    deleteRemoteBranch: vi.fn(),
  },
  workspace: { status: null },
  ui: {
    getHistoryBranchScope: () => 'all',
    toggleHistoryBranchScopeForRepo: vi.fn(),
  },
  showError: vi.fn(),
  requestSwitch: vi.fn(),
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
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => mocks.workspace }))
vi.mock('@/stores/ui', () => ({ useUiStore: () => mocks.ui }))
vi.mock('@/composables/useSidebarSectionState', () => ({
  useSidebarSectionState: () => ({ isCollapsed: () => false, toggle: vi.fn() }),
}))
vi.mock('@/composables/useBranchSwitch', () => ({
  useBranchSwitch: () => ({
    requestSwitch: mocks.requestSwitch,
    dialogVisible: false,
    sourceBranch: '',
    targetBranch: '',
    changeCount: 0,
    loading: false,
    activeMode: null,
    changesStashed: false,
    changesDiscarded: false,
    error: null,
    confirmSwitch: vi.fn(),
    cancelSwitch: vi.fn(),
  }),
}))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showError: mocks.showError,
    showActionError: (error: unknown, fallback?: string) =>
      mocks.showError(fallback ?? String(error)),
  }),
}))

async function requestDelete(branch: BranchInfo = localBranch) {
  const wrapper = shallowMount(SidebarLocalBranches)
  wrapper.findComponent(BranchTreeNode).vm.$emit(
    'branch-context-menu',
    new MouseEvent('contextmenu'),
    branch,
  )
  await flushPromises()
  wrapper.findComponent(ContextMenu).vm.$emit('select', 'delete')
  await flushPromises()
  return wrapper
}

describe('SidebarLocalBranches guarded deletion', () => {
  beforeEach(() => {
    mocks.repo.activeRepoId = 'repo-a'
    mocks.history.branches = [{ ...localBranch }, { ...remoteBranch }]
    mocks.history.deleteBranch.mockReset().mockResolvedValue(undefined)
    mocks.history.deleteRemoteBranch.mockReset().mockResolvedValue(undefined)
    mocks.showError.mockReset()
    mocks.requestSwitch.mockReset().mockResolvedValue(undefined)
  })

  it('deletes the confirmed remote target before the confirmed local target', async () => {
    const order: string[] = []
    mocks.history.deleteRemoteBranch.mockImplementation(async () => { order.push('remote') })
    mocks.history.deleteBranch.mockImplementation(async () => { order.push('local') })
    const wrapper = await requestDelete()
    const dialog = wrapper.findComponent(ConfirmDialog)

    expect(dialog.props('message')).toContain('1111111')
    expect(dialog.props('message')).toContain('2222222')
    expect(dialog.props('checkboxLabel')).toContain('2222222')
    dialog.vm.$emit('update:checkboxValue', true)
    dialog.vm.$emit('confirm')
    await flushPromises()

    expect(order).toEqual(['remote', 'local'])
    expect(mocks.history.deleteRemoteBranch).toHaveBeenCalledWith(
      'origin',
      'feature',
      remoteBranch.commit_oid,
    )
    expect(mocks.history.deleteBranch).toHaveBeenCalledWith(
      'feature',
      localBranch.commit_oid,
    )
  })

  it('does not offer remote deletion when the configured upstream is gone', async () => {
    mocks.history.branches = [{ ...localBranch }]
    const wrapper = await requestDelete()
    const dialog = wrapper.findComponent(ConfirmDialog)

    expect(dialog.props('message')).toContain('confirmDeleteGoneUpstream')
    expect(dialog.props('checkboxLabel')).toBeUndefined()
    dialog.vm.$emit('confirm')
    await flushPromises()

    expect(mocks.history.deleteRemoteBranch).not.toHaveBeenCalled()
    expect(mocks.history.deleteBranch).toHaveBeenCalledWith(
      'feature',
      localBranch.commit_oid,
    )
  })

  it('keeps both branches when the local target changes after confirmation', async () => {
    const wrapper = await requestDelete()
    mocks.history.branches = [{ ...localBranch, commit_oid: '3333333333333333333333333333333333333333' }]

    wrapper.findComponent(ConfirmDialog).vm.$emit('confirm')
    await flushPromises()

    expect(mocks.history.deleteRemoteBranch).not.toHaveBeenCalled()
    expect(mocks.history.deleteBranch).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalled()
  })

  it('reports a failed double-click branch switch', async () => {
    const switchError = new Error('checkout failed')
    mocks.requestSwitch.mockRejectedValue(switchError)
    const wrapper = shallowMount(SidebarLocalBranches)

    wrapper.findComponent(BranchTreeNode).vm.$emit('dblclick-branch', localBranch)
    await flushPromises()

    expect(mocks.requestSwitch).toHaveBeenCalledWith('feature')
    expect(mocks.showError).toHaveBeenCalledWith(
      'sidebar.branch.switchFailed Error: checkout failed',
    )
  })

  it('reports a failed context-menu branch switch', async () => {
    const switchError = new Error('checkout failed')
    mocks.requestSwitch.mockRejectedValue(switchError)
    const wrapper = shallowMount(SidebarLocalBranches)
    wrapper.findComponent(BranchTreeNode).vm.$emit(
      'branch-context-menu',
      new MouseEvent('contextmenu'),
      localBranch,
    )
    await flushPromises()

    wrapper.findComponent(ContextMenu).vm.$emit('select', 'switch')
    await flushPromises()

    expect(mocks.requestSwitch).toHaveBeenCalledWith('feature')
    expect(mocks.showError).toHaveBeenCalledWith(
      'sidebar.branch.switchFailed Error: checkout failed',
    )
  })
})
