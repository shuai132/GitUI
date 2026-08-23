<script setup lang="ts">
import type { BranchInfo, CommitInfo } from '@/types/git'
import FileHistoryModal from '@/components/file-history/FileHistoryModal.vue'
import CreateBranchDialog from '@/components/commit/CreateBranchDialog.vue'
import CreateTagDialog from '@/components/commit/CreateTagDialog.vue'
import CheckoutRemoteDialog from '@/components/branch/CheckoutRemoteDialog.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import Modal from '@/components/common/Modal.vue'
import MergeDialog from '@/components/merge/MergeDialog.vue'
import RebasePlanDialog from '@/components/rebase/RebasePlanDialog.vue'
import DragActionDialog from '@/components/history/DragActionDialog.vue'
import type { HistoryActionConfirmation } from '@/composables/history/historyActionConfirmation'

interface FileHistoryState {
  visible: boolean
  filePath: string
  mode: 'history' | 'blame'
}

interface DropUnreachableDialogState {
  visible: boolean
  repoId: string | null
  commit: CommitInfo | null
  count: number
  contextId: string
  previewing: boolean
  previewError: string | null
  submitting: boolean
}

defineProps<{
  showCreateBranchDialog: boolean
  showCreateTagDialog: boolean
  createTagAnnotated: boolean
  dialogCommit: CommitInfo | null
  showCheckoutRemoteDialog: boolean
  remoteBranches: BranchInfo[]
  checkoutInitialRemote: string | null
  showMergeDialog: boolean
  mergeSourceCandidates: string[]
  showRebaseDialog: boolean
  rebaseUpstream: string
  rebaseOnto: string | null
  showDragDialog: boolean
  dragSourceOid: string | null
  dragTargetOid: string | null
  showEditMessageDialog: boolean
  editMessageText: string
  editMessageAuthorTime: string
  editMessageCommitterTime: string
  editMessageAuthorName: string
  editMessageAuthorEmail: string
  editMessageAutoStash: boolean
  editMessageSubmitting: boolean
  isEditingHeadCommit: boolean
  pendingActionConfirmation: HistoryActionConfirmation | null
  actionConfirmationLoading: boolean
  dropUnreachableDialog: DropUnreachableDialogState
  fileHistoryModal: FileHistoryState
}>()

const emit = defineEmits<{
  'update:showCreateBranchDialog': [value: boolean]
  'update:showCreateTagDialog': [value: boolean]
  'update:showCheckoutRemoteDialog': [value: boolean]
  'update:showMergeDialog': [value: boolean]
  'update:showRebaseDialog': [value: boolean]
  'update:showDragDialog': [value: boolean]
  'update:showEditMessageDialog': [value: boolean]
  'update:editMessageText': [value: string]
  'update:editMessageAuthorTime': [value: string]
  'update:editMessageCommitterTime': [value: string]
  'update:editMessageAuthorName': [value: string]
  'update:editMessageAuthorEmail': [value: string]
  'update:editMessageAutoStash': [value: boolean]
  closeFileHistory: []
  dragDialogMerge: []
  dragDialogRebase: []
  editMessageConfirm: []
  actionConfirmationConfirm: []
  actionConfirmationCancel: []
  dropUnreachableConfirm: []
  dropUnreachableCancel: []
}>()
</script>

<template>
  <CreateBranchDialog
    :visible="showCreateBranchDialog"
    :commit="dialogCommit"
    @close="emit('update:showCreateBranchDialog', false)"
  />

  <CreateTagDialog
    :visible="showCreateTagDialog"
    :commit="dialogCommit"
    :annotated="createTagAnnotated"
    @close="emit('update:showCreateTagDialog', false)"
  />

  <CheckoutRemoteDialog
    :visible="showCheckoutRemoteDialog"
    :remote-branches="remoteBranches"
    :initial-remote="checkoutInitialRemote"
    @close="emit('update:showCheckoutRemoteDialog', false)"
  />

  <MergeDialog
    :visible="showMergeDialog"
    :source-commit-oid="null"
    :candidate-sources="mergeSourceCandidates"
    @close="emit('update:showMergeDialog', false)"
  />

  <RebasePlanDialog
    :visible="showRebaseDialog"
    :upstream="rebaseUpstream"
    :onto="rebaseOnto"
    @close="emit('update:showRebaseDialog', false)"
  />

  <DragActionDialog
    :visible="showDragDialog"
    :source-oid="dragSourceOid"
    :target-oid="dragTargetOid"
    @close="emit('update:showDragDialog', false)"
    @merge="emit('dragDialogMerge')"
    @rebase="emit('dragDialogRebase')"
  />

  <ConfirmDialog
    :visible="pendingActionConfirmation !== null"
    :title="pendingActionConfirmation?.title ?? ''"
    :message="pendingActionConfirmation?.message ?? ''"
    :confirm-label="pendingActionConfirmation?.confirmLabel"
    :loading-label="pendingActionConfirmation?.loadingLabel"
    :danger="pendingActionConfirmation?.danger"
    :loading="actionConfirmationLoading"
    @confirm="emit('actionConfirmationConfirm')"
    @cancel="emit('actionConfirmationCancel')"
  />

  <Modal
    v-if="showEditMessageDialog"
    :visible="showEditMessageDialog"
    :title="$t('history.dialog.editMessage.title')"
    width="min(560px, calc(100vw - 32px))"
    @close="emit('update:showEditMessageDialog', false)"
  >
    <div v-if="!isEditingHeadCommit" class="edit-message-hint">
      {{ $t('history.dialog.editMessage.rewordHint') }}
    </div>
    <textarea
      :value="editMessageText"
      class="edit-message-input"
      rows="6"
      spellcheck="false"
      autocomplete="off"
      @input="emit('update:editMessageText', ($event.target as HTMLTextAreaElement).value)"
    />
    <div class="edit-message-times">
      <div class="edit-message-time-row">
        <span class="edit-message-time-label">{{ $t('history.dialog.editMessage.committerDate') }}</span>
        <input
          :value="editMessageCommitterTime"
          type="datetime-local"
          step="1"
          class="edit-message-time-input"
          @input="emit('update:editMessageCommitterTime', ($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          class="edit-message-sync-time-btn"
          :disabled="!editMessageAuthorTime || editMessageCommitterTime === editMessageAuthorTime"
          :title="$t('history.dialog.editMessage.syncCommitterDateTitle')"
          @click="emit('update:editMessageCommitterTime', editMessageAuthorTime)"
        >
          {{ $t('history.dialog.editMessage.syncCommitterDate') }}
        </button>
      </div>
      <div class="edit-message-time-row">
        <span class="edit-message-time-label">{{ $t('history.dialog.editMessage.authorDate') }}</span>
        <input
          :value="editMessageAuthorTime"
          type="datetime-local"
          step="1"
          class="edit-message-time-input"
          @input="emit('update:editMessageAuthorTime', ($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          class="edit-message-sync-time-btn"
          :disabled="!editMessageCommitterTime || editMessageAuthorTime === editMessageCommitterTime"
          :title="$t('history.dialog.editMessage.syncAuthorDateTitle')"
          @click="emit('update:editMessageAuthorTime', editMessageCommitterTime)"
        >
          {{ $t('history.dialog.editMessage.syncAuthorDate') }}
        </button>
      </div>
      <label class="edit-message-time-row">
        <span class="edit-message-time-label">{{ $t('history.dialog.editMessage.authorName') }}</span>
        <input
          :value="editMessageAuthorName"
          type="text"
          class="edit-message-time-input"
          autocomplete="off"
          spellcheck="false"
          @input="emit('update:editMessageAuthorName', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="edit-message-time-row">
        <span class="edit-message-time-label">{{ $t('history.dialog.editMessage.authorEmail') }}</span>
        <input
          :value="editMessageAuthorEmail"
          type="email"
          class="edit-message-time-input"
          autocomplete="off"
          spellcheck="false"
          @input="emit('update:editMessageAuthorEmail', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>
    <label v-if="!isEditingHeadCommit" class="edit-message-autostash">
      <input
        :checked="editMessageAutoStash"
        type="checkbox"
        @change="emit('update:editMessageAutoStash', ($event.target as HTMLInputElement).checked)"
      />
      <span>{{ $t('history.dialog.editMessage.autoStash') }}</span>
    </label>
    <template #footer>
      <button class="btn btn-secondary" @click="emit('update:showEditMessageDialog', false)">{{ $t('common.cancel') }}</button>
      <button
        class="btn btn-primary"
        :disabled="!editMessageText.trim() || editMessageSubmitting"
        @click="emit('editMessageConfirm')"
      >{{ $t('history.dialog.editMessage.confirm') }}</button>
    </template>
  </Modal>

  <Modal
    v-if="dropUnreachableDialog.visible"
    :visible="dropUnreachableDialog.visible"
    :title="$t('history.dialog.dropUnreachable.title')"
    width="480px"
    @close="emit('dropUnreachableCancel')"
  >
    <p class="drop-unreachable-body">
      <template v-if="dropUnreachableDialog.previewing">
        {{ $t('history.dialog.dropUnreachable.previewing') }}
      </template>
      <template v-else-if="dropUnreachableDialog.previewError">
        <span class="drop-unreachable-error">{{ dropUnreachableDialog.previewError }}</span>
      </template>
      <template v-else-if="dropUnreachableDialog.count === 0">
        {{
          $t('history.dialog.dropUnreachable.emptyBody', {
            shortOid: dropUnreachableDialog.commit?.short_oid ?? '',
          })
        }}
      </template>
      <template v-else>
        {{ $t('history.dialog.dropUnreachable.body', {
          shortOid: dropUnreachableDialog.commit?.short_oid ?? '',
          count: dropUnreachableDialog.count,
        }) }}
      </template>
    </p>
    <template #footer>
      <button
        class="btn btn-secondary"
        :disabled="dropUnreachableDialog.submitting"
        @click="emit('dropUnreachableCancel')"
      >
        {{
          !dropUnreachableDialog.previewing &&
          (dropUnreachableDialog.previewError || dropUnreachableDialog.count === 0)
            ? $t('history.dialog.dropUnreachable.close')
            : $t('common.cancel')
        }}
      </button>
      <button
        v-if="
          !dropUnreachableDialog.previewing &&
          !dropUnreachableDialog.previewError &&
          dropUnreachableDialog.count > 0
        "
        class="btn btn-primary"
        :disabled="dropUnreachableDialog.submitting"
        @click="emit('dropUnreachableConfirm')"
      >{{ $t('history.dialog.dropUnreachable.confirm') }}</button>
    </template>
  </Modal>

  <FileHistoryModal
    v-if="fileHistoryModal.visible"
    :file-path="fileHistoryModal.filePath"
    :initial-mode="fileHistoryModal.mode"
    @close="emit('closeFileHistory')"
  />
</template>

<style scoped>
.edit-message-input {
  width: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-md);
  padding: 8px;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.edit-message-input:focus {
  border-color: var(--accent-blue);
}

.edit-message-hint {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  margin-bottom: 8px;
  padding: 6px 10px;
  background: var(--bg-overlay);
  border-radius: 4px;
}

.edit-message-autostash {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: var(--font-md);
  color: var(--text-secondary);
  cursor: pointer;
}

.edit-message-autostash input[type='checkbox'] {
  cursor: pointer;
  accent-color: var(--accent-blue);
}

.edit-message-times {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.edit-message-time-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: default;
}

.edit-message-time-label {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  min-width: 120px;
  flex-shrink: 0;
}

.edit-message-time-input {
  flex: 1;
  min-width: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-sm);
  padding: 4px 6px;
  outline: none;
  box-sizing: border-box;
}

.edit-message-time-input:focus {
  border-color: var(--accent-blue);
}

.edit-message-sync-time-btn {
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--font-sm);
  line-height: 1.2;
  padding: 5px 8px;
  cursor: pointer;
  white-space: nowrap;
}

.edit-message-sync-time-btn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--accent-blue);
}

.edit-message-sync-time-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.drop-unreachable-body {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--font-md);
  line-height: 1.55;
}

.drop-unreachable-error {
  color: var(--accent-red);
}

@media (max-width: 560px) {
  .edit-message-time-row {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .edit-message-time-label {
    width: 100%;
  }

  .edit-message-time-input {
    flex-basis: 100%;
  }

  .edit-message-sync-time-btn {
    width: 100%;
  }
}
</style>
