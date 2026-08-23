import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ToolbarGitActions from './ToolbarGitActions.vue'

const mocks = vi.hoisted(() => ({
  canUndo: true,
  pullWithChangesVisible: false,
  pendingPullChangeCount: 0,
  isPublishingBranch: false,
  forcePushVisible: false,
  forcePushTarget: '',
  stashPopConfirmVisible: false,
  stashPopTarget: null as { changeCount: number; index: number; message: string } | null,
  onUndoLastCommit: vi.fn(),
  confirmPullWithStash: vi.fn(),
  confirmForcePush: vi.fn(),
  cancelForcePush: vi.fn(),
  confirmStashPop: vi.fn(),
  cancelStashPop: vi.fn(),
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
    isPublishingBranch: mocks.isPublishingBranch,
    canStash: false,
    canStashPop: false,
    pullWithChangesVisible: mocks.pullWithChangesVisible,
    pendingPullChangeCount: mocks.pendingPullChangeCount,
    pullWithChangesLoading: false,
    forcePushVisible: mocks.forcePushVisible,
    forcePushTarget: mocks.forcePushTarget,
    forcePushLoading: false,
    stashPopConfirmVisible: mocks.stashPopConfirmVisible,
    stashPopTarget: mocks.stashPopTarget,
    stashPopLoading: false,
    canUndoLastCommit: mocks.canUndo,
    undoingCommit: false,
    withShortcut: (label: string) => label,
    showAddRepoMenu: vi.fn(),
    onPull: vi.fn(),
    doPull: vi.fn(),
    confirmPullWithStash: mocks.confirmPullWithStash,
    cancelPullWithStash: vi.fn(),
    confirmForcePush: mocks.confirmForcePush,
    cancelForcePush: mocks.cancelForcePush,
    confirmStashPop: mocks.confirmStashPop,
    cancelStashPop: mocks.cancelStashPop,
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

describe('ToolbarGitActions', () => {
  beforeEach(() => {
    mocks.canUndo = true
    mocks.pullWithChangesVisible = false
    mocks.pendingPullChangeCount = 0
    mocks.isPublishingBranch = false
    mocks.forcePushVisible = false
    mocks.forcePushTarget = ''
    mocks.stashPopConfirmVisible = false
    mocks.stashPopTarget = null
    mocks.onUndoLastCommit.mockReset()
    mocks.confirmPullWithStash.mockReset()
    mocks.confirmForcePush.mockReset()
    mocks.cancelForcePush.mockReset()
    mocks.confirmStashPop.mockReset()
    mocks.cancelStashPop.mockReset()
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

  it('wires the dirty-worktree Pull confirmation to the auto-stash action', () => {
    mocks.pullWithChangesVisible = true
    mocks.pendingPullChangeCount = 3
    const wrapper = mount(ToolbarGitActions, {
      global: { stubs: { ContextMenu: true } },
    })

    const dialog = wrapper.findComponent(ConfirmDialog)
    expect(dialog.props('visible')).toBe(true)
    expect(dialog.props('message')).toBe('toolbar.pullWithChanges.message')
    dialog.vm.$emit('confirm')
    expect(mocks.confirmPullWithStash).toHaveBeenCalledOnce()
  })

  it('labels a branch without upstream as Publish', () => {
    mocks.isPublishingBranch = true
    const wrapper = mount(ToolbarGitActions, {
      global: { stubs: { ContextMenu: true } },
    })

    const pushButton = wrapper.findAll('.btn-tool--main')[1]
    expect(pushButton?.attributes('title')).toBe('toolbar.title.publishBranch')
    expect(pushButton?.text()).toContain('toolbar.opLabels.publishBranch')
  })

  it('shows the raw Force Push target behind a danger confirmation', () => {
    mocks.forcePushVisible = true
    mocks.forcePushTarget = 'origin/feature/demo'
    const wrapper = mount(ToolbarGitActions, {
      global: { stubs: { ContextMenu: true } },
    })

    const dialog = wrapper
      .findAllComponents(ConfirmDialog)
      .find((item) => item.props('title') === 'toolbar.forcePushConfirm.title')
    expect(dialog?.props('visible')).toBe(true)
    expect(dialog?.props('danger')).toBe(true)
    expect(dialog?.props('message')).toBe('toolbar.forcePushConfirm.message')
    dialog?.vm.$emit('confirm')
    expect(mocks.confirmForcePush).toHaveBeenCalledOnce()
    dialog?.vm.$emit('cancel')
    expect(mocks.cancelForcePush).toHaveBeenCalledOnce()
  })

  it('shows the latest stash and dirty-file count before toolbar Pop', () => {
    mocks.stashPopConfirmVisible = true
    mocks.stashPopTarget = {
      changeCount: 2,
      index: 0,
      message: 'WIP on feature/demo',
    }
    const wrapper = mount(ToolbarGitActions, {
      global: { stubs: { ContextMenu: true } },
    })

    const dialog = wrapper
      .findAllComponents(ConfirmDialog)
      .find((item) => item.props('title') === 'toolbar.stashPopConfirm.title')
    expect(dialog?.props('visible')).toBe(true)
    expect(dialog?.props('message')).toBe('toolbar.stashPopConfirm.message')
    dialog?.vm.$emit('confirm')
    expect(mocks.confirmStashPop).toHaveBeenCalledOnce()
    dialog?.vm.$emit('cancel')
    expect(mocks.cancelStashPop).toHaveBeenCalledOnce()
  })
})
