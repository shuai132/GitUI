import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BranchInfo, CommitInfo, WorkspaceStatus } from '@/types/git'
import CreateBranchDialog from './CreateBranchDialog.vue'
import CreateTagDialog from './CreateTagDialog.vue'
import CheckoutRemoteDialog from '@/components/branch/CheckoutRemoteDialog.vue'

const selectedCommit: CommitInfo = {
  oid: '1111111111111111111111111111111111111111',
  short_oid: '1111111',
  message: 'Selected commit',
  summary: 'Selected commit',
  author_name: 'Test',
  author_email: 'test@example.com',
  author_time: 1,
  time: 1,
  parent_oids: [],
  is_unreachable: false,
  is_stash: false,
  is_reflog_tip: false,
}

const remoteBranch: BranchInfo = {
  name: 'origin/feature',
  is_remote: true,
  is_head: false,
  commit_oid: selectedCommit.oid,
}

const workspaceStatus: WorkspaceStatus = {
  staged: [],
  unstaged: [],
  untracked: [],
  head_branch: 'main',
  head_commit: '2222222222222222222222222222222222222222',
  is_detached: false,
  repo_state: { kind: 'clean' },
}

const mocks = vi.hoisted(() => ({
  repo: { activeRepoId: 'repo-a' as string | null },
  workspace: { status: null as WorkspaceStatus | null },
  history: {
    branches: [] as BranchInfo[],
    createBranch: vi.fn(),
    switchBranchInRepo: vi.fn(),
    createTag: vi.fn(),
    checkoutRemoteBranch: vi.fn(),
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => mocks.workspace }))
vi.mock('@/stores/history', () => ({ useHistoryStore: () => mocks.history }))

const ModalStub = defineComponent({
  props: { visible: Boolean },
  template: '<div v-if="visible"><slot /><slot name="footer" /></div>',
})

describe('reference creation dialog repository context', () => {
  beforeEach(() => {
    mocks.repo.activeRepoId = 'repo-a'
    mocks.workspace.status = workspaceStatus
    mocks.history.branches = []
    mocks.history.createBranch.mockReset().mockResolvedValue(undefined)
    mocks.history.switchBranchInRepo.mockReset().mockResolvedValue(undefined)
    mocks.history.createTag.mockReset().mockResolvedValue(undefined)
    mocks.history.checkoutRemoteBranch.mockReset().mockResolvedValue(undefined)
  })

  it('keeps a branch target bound to the opening repository and commit', async () => {
    const wrapper = mount(CreateBranchDialog, {
      props: { visible: false, commit: selectedCommit },
      global: { stubs: { Modal: ModalStub } },
    })
    await wrapper.setProps({ visible: true })
    await wrapper.find<HTMLInputElement>('input[type="text"]').setValue('feature/demo')
    mocks.repo.activeRepoId = 'repo-b'

    await wrapper.find('.btn-primary').trigger('click')

    expect(mocks.history.createBranch).not.toHaveBeenCalled()
    expect(wrapper.find('.form-error').text()).toBe('branch.formContextChanged')

    mocks.repo.activeRepoId = 'repo-a'
    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(mocks.history.createBranch).toHaveBeenCalledWith(
      'repo-a',
      'feature/demo',
      selectedCommit.oid,
    )
    expect(mocks.history.switchBranchInRepo).toHaveBeenCalledWith('repo-a', 'feature/demo')
  })

  it('keeps a Tag target bound to the opening repository and commit', async () => {
    const wrapper = mount(CreateTagDialog, {
      props: { visible: false, commit: selectedCommit, annotated: false },
      global: { stubs: { Modal: ModalStub } },
    })
    await wrapper.setProps({ visible: true })
    await wrapper.find<HTMLInputElement>('input').setValue('v1.0.0')
    mocks.repo.activeRepoId = 'repo-b'

    await wrapper.find('.btn-primary').trigger('click')

    expect(mocks.history.createTag).not.toHaveBeenCalled()
    expect(wrapper.find('.form-error').text()).toBe('tag.formContextChanged')

    mocks.repo.activeRepoId = 'repo-a'
    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(mocks.history.createTag).toHaveBeenCalledWith(
      'repo-a',
      'v1.0.0',
      selectedCommit.oid,
      null,
    )
  })

  it('keeps remote checkout choices bound to the opening repository', async () => {
    const wrapper = mount(CheckoutRemoteDialog, {
      props: {
        visible: false,
        remoteBranches: [remoteBranch],
        initialRemote: remoteBranch.name,
      },
      global: { stubs: { Modal: ModalStub } },
    })
    await wrapper.setProps({ visible: true })
    await flushPromises()
    mocks.repo.activeRepoId = 'repo-b'

    await wrapper.find('.btn-primary').trigger('click')

    expect(mocks.history.checkoutRemoteBranch).not.toHaveBeenCalled()
    expect(wrapper.find('.form-error').text()).toBe('branch.formContextChanged')

    mocks.repo.activeRepoId = 'repo-a'
    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(mocks.history.checkoutRemoteBranch).toHaveBeenCalledWith(
      'repo-a',
      'origin/feature',
      'feature',
      true,
    )
  })
})
