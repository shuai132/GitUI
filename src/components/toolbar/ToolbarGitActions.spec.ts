import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ToolbarGitActions from './ToolbarGitActions.vue'

const mocks = vi.hoisted(() => ({
  canUndo: true,
  onUndoLastCommit: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/composables/toolbar/useRemoteActionMenu', () => ({
  useRemoteActionMenu: () => ({
    pickRemote: vi.fn(),
    remoteMenu: { visible: false, x: 0, y: 0, items: [] },
    onRemoteMenuSelect: vi.fn(),
    onRemoteMenuClose: vi.fn(),
    pullModeMenu: { visible: false, x: 0, y: 0 },
    pullModeMenuItems: [],
    pullChevronRect: { value: null },
    onPullChevronClick: vi.fn(),
    closePullModeMenu: vi.fn(),
    pushModeMenu: { visible: false, x: 0, y: 0 },
    pushModeMenuItems: [],
    pushChevronRect: { value: null },
    onPushChevronClick: vi.fn(),
    closePushModeMenu: vi.fn(),
  }),
}))

vi.mock('@/composables/toolbar/useToolbarGitActions', () => ({
  useToolbarGitActions: () => ({
    stashStore: { entries: [] },
    busy: {
      pull: false,
      push: false,
      stash: false,
      pop: false,
      fetch: false,
      refresh: false,
    },
    hasRepo: true,
    canRemoteOp: true,
    canStash: false,
    canStashPop: false,
    canUndoLastCommit: mocks.canUndo,
    undoingCommit: false,
    withShortcut: (label: string) => label,
    showAddRepoMenu: vi.fn(),
    onPull: vi.fn(),
    doPull: vi.fn(),
    onPush: vi.fn(),
    doPush: vi.fn(),
    onStash: vi.fn(),
    onPop: vi.fn(),
    onFetch: vi.fn(),
    onRefreshRepository: vi.fn(),
    onOpenSystemTerminal: vi.fn(),
    onUndoLastCommit: mocks.onUndoLastCommit,
  }),
}))

describe('ToolbarGitActions commit undo', () => {
  beforeEach(() => {
    mocks.canUndo = true
    mocks.onUndoLastCommit.mockReset()
  })

  it('shows and invokes Undo only while a recent commit candidate is available', async () => {
    const wrapper = mount(ToolbarGitActions, {
      global: { stubs: { ContextMenu: true } },
    })

    const undo = wrapper.find('.btn-tool--undo')
    expect(undo.exists()).toBe(true)
    expect(undo.attributes('title')).toBe('toolbar.title.undoCommit')
    await undo.trigger('click')
    expect(mocks.onUndoLastCommit).toHaveBeenCalledOnce()

    wrapper.unmount()
    mocks.canUndo = false
    const hiddenWrapper = mount(ToolbarGitActions, {
      global: { stubs: { ContextMenu: true } },
    })
    expect(hiddenWrapper.find('.btn-tool--undo').exists()).toBe(false)
  })
})
