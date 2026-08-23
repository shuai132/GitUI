import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BranchInfo, WorkspaceStatus } from '@/types/git'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import BranchList from './BranchList.vue'

const branch: BranchInfo = {
  name: 'feature',
  is_remote: false,
  is_head: false,
  commit_oid: '1111111111111111111111111111111111111111',
}

const mocks = vi.hoisted(() => ({
  repo: { activeRepoId: 'repo-a' as string | null },
  history: {
    branches: [] as BranchInfo[],
    deleteBranch: vi.fn(),
    createBranch: vi.fn(),
  },
  workspace: { status: null as WorkspaceStatus | null },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      `${key} ${Object.values(params ?? {}).join(' ')}`.trim(),
  }),
}))
vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('@/stores/history', () => ({ useHistoryStore: () => mocks.history }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => mocks.workspace }))
vi.mock('@/composables/useBranchSwitch', () => ({
  useBranchSwitch: () => ({
    requestSwitch: vi.fn(),
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

describe('BranchList guarded actions', () => {
  beforeEach(() => {
    mocks.repo.activeRepoId = 'repo-a'
    mocks.history.branches = [{ ...branch }]
    mocks.history.deleteBranch.mockReset().mockResolvedValue(undefined)
    mocks.history.createBranch.mockReset().mockResolvedValue(undefined)
    mocks.workspace.status = {
      staged: [],
      unstaged: [],
      untracked: [],
      head_branch: 'main',
      head_commit: '2222222222222222222222222222222222222222',
      is_detached: false,
      repo_state: { kind: 'clean' },
    }
  })

  it('uses an in-app confirmation and the displayed branch target', async () => {
    const wrapper = shallowMount(BranchList)
    await wrapper.find('.btn-delete').trigger('click')
    const dialog = wrapper.findComponent(ConfirmDialog)

    expect(dialog.props('visible')).toBe(true)
    expect(dialog.props('message')).toContain('1111111')
    dialog.vm.$emit('confirm')
    await flushPromises()

    expect(mocks.history.deleteBranch).toHaveBeenCalledWith('feature', branch.commit_oid)
  })

  it('preserves an inline branch form instead of applying it to another repository', async () => {
    const wrapper = shallowMount(BranchList)
    await wrapper.find('.btn-new').trigger('click')
    const input = wrapper.find<HTMLInputElement>('.branch-input')
    await input.setValue('feature/demo')
    mocks.repo.activeRepoId = 'repo-b'

    await wrapper.find('.btn-create').trigger('click')

    expect(mocks.history.createBranch).not.toHaveBeenCalled()
    expect(wrapper.find('.error-msg').text()).toContain('branch.formContextChanged')
    expect(input.element.value).toBe('feature/demo')

    mocks.repo.activeRepoId = 'repo-a'
    await wrapper.find('.btn-create').trigger('click')
    await flushPromises()

    expect(mocks.history.createBranch).toHaveBeenCalledWith(
      'repo-a',
      'feature/demo',
      '2222222222222222222222222222222222222222',
    )
  })
})
