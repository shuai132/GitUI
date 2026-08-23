import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BranchSwitchDialog from './BranchSwitchDialog.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

function baseProps() {
  return {
    visible: true,
    sourceBranch: 'main',
    targetBranch: 'feature',
    changeCount: 2,
    loading: false,
    activeMode: null,
    changesStashed: false,
    changesDiscarded: false,
    error: null,
  }
}

describe('BranchSwitchDialog', () => {
  it('offers carry, stash and recoverable discard for a dirty worktree', async () => {
    const wrapper = mount(BranchSwitchDialog, {
      props: baseProps(),
      global: { stubs: { Teleport: true } },
    })
    const buttons = wrapper.findAll('button')

    expect(buttons.map((button) => button.text())).toEqual([
      'common.cancel',
      'sidebar.branch.switchDialog.discardAndSwitch',
      'sidebar.branch.switchDialog.stashAndSwitch',
      'sidebar.branch.switchDialog.carryAndSwitch',
    ])

    await buttons[1]?.trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([['discard']])
  })

  it('shows only retry after changes have already been discarded', () => {
    const wrapper = mount(BranchSwitchDialog, {
      props: {
        ...baseProps(),
        changesDiscarded: true,
        error: 'switch failed',
      },
      global: { stubs: { Teleport: true } },
    })

    expect(wrapper.text()).toContain('sidebar.branch.switchDialog.discardSafe')
    expect(wrapper.text()).toContain('switch failed')
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
      'common.cancel',
      'sidebar.branch.switchDialog.retry',
    ])
  })
})
