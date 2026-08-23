import { shallowMount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import HistoryDialogs from './HistoryDialogs.vue'
import type { HistoryActionConfirmation } from '@/composables/history/historyActionConfirmation'

function baseProps() {
  return {
    showCreateBranchDialog: false,
    showCreateTagDialog: false,
    createTagAnnotated: false,
    dialogCommit: null,
    showCheckoutRemoteDialog: false,
    remoteBranches: [],
    checkoutInitialRemote: null,
    showMergeDialog: false,
    mergeSourceCandidates: [],
    showRebaseDialog: false,
    rebaseUpstream: '',
    rebaseOnto: null,
    showDragDialog: false,
    dragSourceOid: null,
    dragTargetOid: null,
    showEditMessageDialog: false,
    editMessageText: '',
    editMessageAuthorTime: '',
    editMessageCommitterTime: '',
    editMessageAuthorName: '',
    editMessageAuthorEmail: '',
    editMessageAutoStash: false,
    editMessageSubmitting: false,
    isEditingHeadCommit: false,
    pendingActionConfirmation: null,
    actionConfirmationLoading: false,
    dropUnreachableDialog: {
      visible: false,
      repoId: null,
      commit: null,
      count: 0,
      contextId: '',
      previewing: false,
      previewError: null,
      submitting: false,
    },
    fileHistoryModal: {
      visible: false,
      filePath: '',
      mode: 'history' as const,
    },
  }
}

describe('HistoryDialogs action confirmation', () => {
  it('renders the captured target and forwards confirm and cancel', () => {
    const pending: HistoryActionConfirmation = {
      kind: 'reset',
      repoId: 'repo-a',
      expectedHeadOid: 'head-a',
      expectedHeadRef: 'refs/heads/main',
      commitOid: 'commit-a',
      mode: 'hard',
      title: 'Reset main?',
      message: 'Hard reset main to abc1234?',
      confirmLabel: 'Run hard reset',
      loadingLabel: 'Resetting…',
      danger: true,
    }
    const wrapper = shallowMount(HistoryDialogs, {
      props: {
        ...baseProps(),
        pendingActionConfirmation: pending,
        actionConfirmationLoading: true,
      },
    })

    const dialog = wrapper.findComponent(ConfirmDialog)
    expect(dialog.props()).toMatchObject({
      visible: true,
      title: pending.title,
      message: pending.message,
      confirmLabel: pending.confirmLabel,
      loadingLabel: pending.loadingLabel,
      danger: true,
      loading: true,
    })

    dialog.vm.$emit('confirm')
    dialog.vm.$emit('cancel')
    expect(wrapper.emitted('actionConfirmationConfirm')).toHaveLength(1)
    expect(wrapper.emitted('actionConfirmationCancel')).toHaveLength(1)
  })
})
