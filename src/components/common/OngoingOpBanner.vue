<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useMergeRebaseStore } from '@/stores/mergeRebase'
import { useWorkspaceStore } from '@/stores/workspace'
import Modal from './Modal.vue'

const { t } = useI18n()
const mr = useMergeRebaseStore()
const workspaceStore = useWorkspaceStore()
const { repoState, isOngoing, isMerging, isRebasing, busy } = storeToRefs(mr)

const showContinueDialog = ref(false)
const continueMessage = ref('')

const hasConflicts = computed(() => {
  const s = workspaceStore.status
  if (!s) return false
  return s.unstaged.some(f => f.status === 'conflicted')
})

const headline = computed(() => {
  if (hasConflicts.value) return t('ongoing.conflicts')
  if (isMerging.value) return t('ongoing.merge.inProgress')
  if (isRebasing.value) return t('ongoing.rebase.inProgress')
  const k = repoState.value?.kind ?? 'clean'
  return t(`ongoing.generic.${k}`)
})

const detail = computed(() => {
  const st = repoState.value
  if (!st) return ''
  if (isMerging.value) {
    const target = st.merge_head ? st.merge_head.slice(0, 7) : '?'
    return t('ongoing.merge.detail', { target })
  }
  if (isRebasing.value) {
    const step = st.rebase_step ?? 0
    const total = st.rebase_total ?? 0
    const cur = st.rebase_current_oid ? st.rebase_current_oid.slice(0, 7) : ''
    return t('ongoing.rebase.detail', { step, total, oid: cur })
  }
  return ''
})

async function onContinue() {
  if (isMerging.value) {
    continueMessage.value = repoState.value?.merge_msg ?? ''
    showContinueDialog.value = true
    return
  }
  if (isRebasing.value) {
    try {
      await mr.continueRebase(null)
    } catch {
      /* errorMap 已上屏 */
    }
  }
}

async function onConfirmMergeContinue() {
  try {
    await mr.continueMerge(continueMessage.value.trim())
    showContinueDialog.value = false
  } catch {
    /* errorMap 已上屏 */
  }
}

async function onSkip() {
  try {
    await mr.skipRebase()
  } catch {
    /* ignore */
  }
}

async function onAbort() {
  const msg = isMerging.value ? t('ongoing.merge.confirmAbort') : t('ongoing.rebase.confirmAbort')
  if (!confirm(msg)) return
  try {
    if (isMerging.value) await mr.abortMerge()
    else if (isRebasing.value) await mr.abortRebase()
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div v-if="isOngoing" class="notice" :class="{ conflict: hasConflicts }">
    <svg class="icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
    <span class="headline">{{ headline }}</span>
    <span v-if="detail" class="detail">— {{ detail }}</span>

    <span class="actions">
      <button
        class="op continue"
        :disabled="busy || hasConflicts"
        :title="hasConflicts ? t('ongoing.resolveFirst') : ''"
        @click="onContinue"
      >{{ t('ongoing.continue') }}</button>
      <button v-if="isRebasing" class="op" :disabled="busy" @click="onSkip">
        {{ t('ongoing.skip') }}
      </button>
      <button class="op danger" :disabled="busy" @click="onAbort">
        {{ t('ongoing.abort') }}
      </button>
    </span>

    <Modal
      :visible="showContinueDialog"
      :title="t('ongoing.merge.continueTitle')"
      width="500px"
      @close="showContinueDialog = false"
    >
      <label class="dlg-label">{{ t('ongoing.merge.messageLabel') }}</label>
      <textarea v-model="continueMessage" class="dlg-textarea" rows="5" />
      <template #footer>
        <button class="btn btn-secondary" @click="showContinueDialog = false">
          {{ t('common.cancel') }}
        </button>
        <button
          class="btn btn-primary"
          :disabled="!continueMessage.trim() || busy"
          @click="onConfirmMergeContinue"
        >{{ t('ongoing.merge.confirmContinue') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.notice {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  width: 100%;
  height: 100%;
  min-height: 22px;
  background: color-mix(in oklab, var(--accent-orange) 18%, var(--bg-secondary));
  border-bottom: 1px solid color-mix(in oklab, var(--accent-orange) 40%, transparent);
  font-size: var(--font-xs);
  white-space: nowrap;
  overflow: hidden;
  flex-shrink: 0;
  color: var(--text-primary);
  box-sizing: border-box;
}

.notice.conflict {
  background: color-mix(in oklab, var(--accent-red) 18%, var(--bg-secondary));
  border-bottom-color: color-mix(in oklab, var(--accent-red) 40%, transparent);
}

.icon {
  color: var(--accent-orange);
  flex-shrink: 0;
}

.notice.conflict .icon {
  color: var(--accent-red);
}

.headline {
  font-weight: 600;
  flex-shrink: 0;
}

.detail {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex-shrink: 1;
}

.actions {
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 10px;
  padding-left: 10px;
  border-left: 1px solid color-mix(in oklab, currentColor 25%, transparent);
}

.op {
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 8px;
  height: 16px;
  line-height: 14px;
  font-size: var(--font-xs);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.op:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.op.continue {
  border-color: var(--accent-blue);
  color: var(--accent-blue);
}

.op.continue:hover:not(:disabled) {
  background: var(--accent-blue);
  color: var(--bg-primary);
}

.op.danger {
  border-color: var(--accent-red);
  color: var(--accent-red);
}

.op.danger:hover:not(:disabled) {
  background: var(--accent-red);
  color: var(--bg-primary);
}

.op:hover:not(:disabled) {
  background: var(--bg-overlay);
}

.dlg-label {
  display: block;
  font-size: var(--font-md);
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.dlg-textarea {
  width: 100%;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: var(--font-mono, monospace);
  font-size: var(--font-md);
  padding: 6px 8px;
  outline: none;
  resize: vertical;
}

.dlg-textarea:focus {
  border-color: var(--accent-blue);
}

</style>
