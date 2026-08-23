import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BranchTreeNode as BranchTreeNodeType } from '@/utils/branchTree'
import BranchTreeNode from './BranchTreeNode.vue'

const mocks = vi.hoisted(() => ({
  collapsed: false,
  toggle: vi.fn(),
}))

vi.mock('@/composables/useBranchTreeState', () => ({
  useBranchTreeState: () => ({
    isCollapsed: () => mocks.collapsed,
    toggle: mocks.toggle,
  }),
}))

const folderNode: BranchTreeNodeType = {
  kind: 'folder',
  name: 'origin',
  path: 'origin',
  children: [],
}

const branchNode: BranchTreeNodeType = {
  kind: 'branch',
  name: 'main',
  fullName: 'main',
  branch: {
    name: 'main',
    is_remote: false,
    is_head: false,
    commit_oid: 'a'.repeat(40),
  },
}

describe('BranchTreeNode keyboard actions', () => {
  beforeEach(() => {
    mocks.collapsed = false
    mocks.toggle.mockReset()
  })

  it('uses a disclosure button for folders and keeps remote deletion separate', async () => {
    const wrapper = mount(BranchTreeNode, {
      props: { node: folderNode, level: 0, isRemoteRoot: true },
    })
    const disclosure = wrapper.find<HTMLButtonElement>('.tree-row-action')
    const deleteButton = wrapper.find<HTMLButtonElement>('.remote-delete-btn')

    expect(disclosure.element.tagName).toBe('BUTTON')
    expect(disclosure.attributes('aria-expanded')).toBe('true')
    expect(deleteButton.attributes('aria-label')).toBe("Remove remote 'origin'")

    await disclosure.trigger('click')
    expect(mocks.toggle).toHaveBeenCalledWith('origin')
    await deleteButton.trigger('click')
    expect(wrapper.emitted('deleteRemote')).toEqual([['origin']])
  })

  it('uses a native button for branch selection without changing double-click behavior', async () => {
    const wrapper = mount(BranchTreeNode, {
      props: { node: branchNode, level: 0 },
    })
    const branchButton = wrapper.find<HTMLButtonElement>('.tree-branch')

    expect(branchButton.element.tagName).toBe('BUTTON')
    await branchButton.trigger('click')
    expect(wrapper.emitted('selectBranch')).toEqual([[branchNode.branch]])

    await branchButton.trigger('dblclick')
    expect(wrapper.emitted('dblclickBranch')).toEqual([[branchNode.branch]])
  })
})
