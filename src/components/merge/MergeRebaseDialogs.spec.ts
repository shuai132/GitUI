import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BranchInfo, RebaseTodoItem, WorkspaceStatus } from '@/types/git'
import MergeDialog from './MergeDialog.vue'
import RebasePlanDialog from '@/components/rebase/RebasePlanDialog.vue'

const headOid = '1111111111111111111111111111111111111111'
const sourceOid = '2222222222222222222222222222222222222222'

const branches: BranchInfo[] = [
  { name: 'main', is_remote: false, is_head: true, commit_oid: headOid },
  { name: 'feature', is_remote: false, is_head: false, commit_oid: sourceOid },
]

const status: WorkspaceStatus = {
  staged: [],
  unstaged: [],
  untracked: [],
  head_branch: 'main',
  head_commit: headOid,
  is_detached: false,
  repo_state: { kind: 'clean' },
}

const planItem: RebaseTodoItem = {
  oid: headOid,
  short_oid: headOid.slice(0, 7),
  action: 'pick',
  subject: 'Commit',
}

const mocks = vi.hoisted(() => ({
  repo: { activeRepoId: 'repo-a' as string | null },
  workspace: { status: null as WorkspaceStatus | null },
  history: { branches: [] as BranchInfo[] },
  mergeRebase: {
    startMerge: vi.fn(),
    planRebase: vi.fn(),
    startRebase: vi.fn(),
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => mocks.workspace }))
vi.mock('@/stores/history', () => ({ useHistoryStore: () => mocks.history }))
vi.mock('@/stores/mergeRebase', () => ({
  useMergeRebaseStore: () => mocks.mergeRebase,
}))

const ModalStub = defineComponent({
  props: { visible: Boolean },
  template: '<div v-if="visible"><slot /><slot name="footer" /></div>',
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Merge and Rebase dialog repository context', () => {
  beforeEach(() => {
    mocks.repo.activeRepoId = 'repo-a'
    mocks.workspace.status = status
    mocks.history.branches = branches.map((branch) => ({ ...branch }))
    mocks.mergeRebase.startMerge.mockReset().mockResolvedValue(undefined)
    mocks.mergeRebase.planRebase.mockReset().mockResolvedValue([{ ...planItem }])
    mocks.mergeRebase.startRebase.mockReset().mockResolvedValue(undefined)
  })

  it('freezes the Merge repository, HEAD, target branch, and source OID', async () => {
    const wrapper = mount(MergeDialog, {
      props: {
        visible: false,
        sourceCommitOid: sourceOid,
        candidateSources: ['feature'],
      },
      global: { stubs: { Modal: ModalStub } },
    })
    await wrapper.setProps({ visible: true })
    expect(wrapper.find('.static').text()).toBe('main')
    mocks.repo.activeRepoId = 'repo-b'

    await wrapper.find('.btn-primary').trigger('click')

    expect(mocks.mergeRebase.startMerge).not.toHaveBeenCalled()
    expect(wrapper.find('.error').text()).toBe('merge.dialog.contextChanged')

    mocks.repo.activeRepoId = 'repo-a'
    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(mocks.mergeRebase.startMerge).toHaveBeenCalledWith(
      'repo-a',
      'feature',
      'auto',
      null,
      false,
      headOid,
      'refs/heads/main',
      sourceOid,
    )
  })

  it('binds the Rebase plan and start request to the opening context', async () => {
    const wrapper = mount(RebasePlanDialog, {
      props: { visible: false, upstream: sourceOid, onto: null },
      global: { stubs: { Modal: ModalStub } },
    })
    await wrapper.setProps({ visible: true })
    await flushPromises()

    expect(mocks.mergeRebase.planRebase).toHaveBeenCalledWith(
      'repo-a',
      sourceOid,
      null,
      headOid,
      'refs/heads/main',
      sourceOid,
      null,
    )
    mocks.repo.activeRepoId = 'repo-b'
    await wrapper.find('.btn-primary').trigger('click')

    expect(mocks.mergeRebase.startRebase).not.toHaveBeenCalled()
    expect(wrapper.find('.error').text()).toBe('rebase.dialog.contextChanged')

    mocks.repo.activeRepoId = 'repo-a'
    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(mocks.mergeRebase.startRebase).toHaveBeenCalledWith(
      'repo-a',
      sourceOid,
      null,
      [{ ...planItem }],
      false,
      headOid,
      'refs/heads/main',
      sourceOid,
      null,
    )
  })

  it('does not let an older Rebase plan overwrite a newly opened dialog', async () => {
    const oldPlan = deferred<RebaseTodoItem[]>()
    const newHead = '3333333333333333333333333333333333333333'
    const newUpstream = '4444444444444444444444444444444444444444'
    const newItem = { ...planItem, oid: newHead, short_oid: newHead.slice(0, 7) }
    mocks.mergeRebase.planRebase
      .mockReset()
      .mockReturnValueOnce(oldPlan.promise)
      .mockResolvedValueOnce([newItem])
    const wrapper = mount(RebasePlanDialog, {
      props: { visible: false, upstream: sourceOid, onto: null },
      global: { stubs: { Modal: ModalStub } },
    })
    await wrapper.setProps({ visible: true })
    await wrapper.setProps({ visible: false, upstream: newUpstream })
    mocks.repo.activeRepoId = 'repo-b'
    mocks.workspace.status = { ...status, head_commit: newHead }
    mocks.history.branches = [
      { name: 'main', is_remote: false, is_head: true, commit_oid: newHead },
    ]
    await wrapper.setProps({ visible: true })
    await flushPromises()

    expect(wrapper.find('.oid').text()).toBe(newHead.slice(0, 7))

    oldPlan.resolve([{ ...planItem }])
    await flushPromises()

    expect(wrapper.find('.oid').text()).toBe(newHead.slice(0, 7))
  })
})
