import { shallowMount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SwitchResetBranchDialog from './SwitchResetBranchDialog.vue'
import Modal from '@/components/common/Modal.vue'
import type { BranchInfo, CommitInfo } from '@/types/git'

const mocks = vi.hoisted(() => ({
  repo: { activeRepoId: 'repo-a' },
  history: {
    branches: [] as BranchInfo[],
    switchAndResetBranch: vi.fn(),
  },
  workspace: {
    status: { head_commit: 'source-oid', head_ref: 'refs/heads/main' },
    refresh: vi.fn(),
  },
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('@/stores/history', () => ({ useHistoryStore: () => mocks.history }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => mocks.workspace }))

const target: CommitInfo = {
  oid: 'target-oid', short_oid: 'target', message: 'target commit', summary: 'target commit',
  author_name: 'Tester', author_email: 'test@example.com', author_time: 0, time: 0,
  parent_oids: [], is_unreachable: false, is_stash: false, is_reflog_tip: false,
}
function mountDialog() {
  return shallowMount(SwitchResetBranchDialog, {
    props: { visible: true, commit: target },
    global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.repo.activeRepoId = 'repo-a'
  mocks.workspace.status = { head_commit: 'source-oid', head_ref: 'refs/heads/main' }
  mocks.history.branches = [
    { name: 'main', is_head: true, is_remote: false, commit_oid: 'source-oid' },
    { name: 'feature', is_head: false, is_remote: false, commit_oid: 'feature-oid' },
    { name: 'origin/main', is_head: false, is_remote: true, commit_oid: 'remote-oid' },
  ]
  mocks.history.switchAndResetBranch.mockResolvedValue(undefined)
  mocks.workspace.refresh.mockResolvedValue(undefined)
})

describe('SwitchResetBranchDialog', () => {
  it('lists only local branches, requires explicit selection and defaults to mixed', async () => {
    const wrapper = mountDialog()
    const selects = wrapper.findAllComponents({ name: 'AppSelect' })
    expect(selects[0]?.props('options').map((option: { value: string }) => option.value)).toEqual(['main', 'feature'])
    expect(selects[1]?.props('modelValue')).toBe('mixed')
    const submit = wrapper.find('button.btn-primary')
    expect(submit.attributes('disabled')).toBeDefined()
    await submit.trigger('click')
    expect(mocks.history.switchAndResetBranch).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('submits the captured repo, commit, HEAD and branch OID even if props and candidates change', async () => {
    const wrapper = mountDialog()
    const selects = wrapper.findAllComponents({ name: 'AppSelect' })
    selects[0]?.vm.$emit('update:modelValue', 'feature')
    selects[1]?.vm.$emit('update:modelValue', 'soft')
    await wrapper.setProps({ commit: { ...target, oid: 'later-commit' } })
    mocks.history.branches[1] = { name: 'feature', is_head: false, is_remote: false, commit_oid: 'moved' }
    mocks.workspace.status.head_commit = 'later-head'
    await wrapper.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(mocks.history.switchAndResetBranch).toHaveBeenCalledWith(
      'repo-a', 'feature', 'target-oid', 'soft', 'source-oid', 'refs/heads/main', 'feature-oid',
    )
    expect(mocks.workspace.refresh).toHaveBeenCalledWith('repo-a')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('rejects a repository change without writing to either repository', async () => {
    const wrapper = mountDialog()
    wrapper.findAllComponents({ name: 'AppSelect' })[0]?.vm.$emit('update:modelValue', 'feature')
    mocks.repo.activeRepoId = 'repo-b'
    await flushPromises()
    await wrapper.find('button.btn-primary').trigger('click')
    expect(mocks.history.switchAndResetBranch).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').text()).toBe('branch.formContextChanged')
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('shows hard reset warning, blocks repeat submits and prevents close while running', async () => {
    let finish: (() => void) | undefined
    mocks.history.switchAndResetBranch.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const wrapper = mountDialog()
    const selects = wrapper.findAllComponents({ name: 'AppSelect' })
    selects[0]?.vm.$emit('update:modelValue', 'feature')
    selects[1]?.vm.$emit('update:modelValue', 'hard')
    await flushPromises()
    expect(wrapper.find('.warning').text()).toBe('history.dialog.switchResetBranch.hardWarning')
    await wrapper.find('button.btn-danger').trigger('click')
    await wrapper.find('button.btn-danger').trigger('click')
    wrapper.findComponent(Modal).vm.$emit('close')
    expect(mocks.history.switchAndResetBranch).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(selects.every(select => select.props('disabled'))).toBe(true)
    finish?.()
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('keeps the form on error and refreshes actual workspace state', async () => {
    mocks.history.switchAndResetBranch.mockRejectedValue(new Error('branch moved'))
    const wrapper = mountDialog()
    wrapper.findAllComponents({ name: 'AppSelect' })[0]?.vm.$emit('update:modelValue', 'feature')
    await flushPromises()
    await wrapper.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('branch moved')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(mocks.workspace.refresh).toHaveBeenCalledWith('repo-a')
    expect(wrapper.findAllComponents({ name: 'AppSelect' })[0]?.props('modelValue')).toBe('feature')
    wrapper.unmount()
  })

  it('disables submission when no local branches exist', () => {
    mocks.history.branches = []
    const wrapper = mountDialog()
    expect(wrapper.text()).toContain('history.dialog.switchResetBranch.empty')
    expect(wrapper.find('button.btn-primary').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
