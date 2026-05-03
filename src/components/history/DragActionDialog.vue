<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'
import { useHistoryStore } from '@/stores/history'
import { useMergeRebaseStore } from '@/stores/mergeRebase'
import { buildDragActionState } from '@/utils/mergeSources'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  sourceOid: string | null
  targetOid: string | null
}>()

const emit = defineEmits<{
  close: []
  merge: []
  rebase: []
}>()

const historyStore = useHistoryStore()
const mergeRebaseStore = useMergeRebaseStore()

function commitInfo(oid: string | null) {
  if (!oid) return null
  return historyStore.commits.find((c) => c.oid === oid) ?? null
}

const source = computed(() => commitInfo(props.sourceOid))
const target = computed(() => commitInfo(props.targetOid))
const headOid = computed(() => {
  const headBranch = historyStore.branches.find((b) => b.is_head && !b.is_remote)
  return headBranch?.commit_oid ?? null
})

const actionState = computed(() =>
  buildDragActionState(
    historyStore.branches,
    props.sourceOid,
    props.targetOid,
    headOid.value,
    mergeRebaseStore.isOngoing,
  ),
)

const currentBranchLabel = computed(
  () => actionState.value.currentBranchName ?? t('drag.dialog.detachedHead'),
)

const mergeSourceLabel = computed(
  () =>
    actionState.value.mergeSourceNames.join(', ') ||
    t('drag.dialog.unknownSource'),
)

const mergeDisabledText = computed(() => {
  const reason = actionState.value.mergeDisabledReason
  return reason ? t(`drag.dialog.disabled.${reason}`) : ''
})

const rebaseDisabledText = computed(() => {
  const reason = actionState.value.rebaseDisabledReason
  return reason ? t(`drag.dialog.disabled.${reason}`) : ''
})
</script>

<template>
  <Modal
    :visible="visible"
    :title="t('drag.dialog.title')"
    width="520px"
    @close="emit('close')"
  >
    <div class="line">
      <span class="label">{{ t('drag.dialog.currentBranch') }}</span>
      <code>{{ currentBranchLabel }}</code>
    </div>

    <div class="line">
      <span class="label">{{ t('drag.dialog.draggedCommit') }}</span>
      <code>{{ source?.short_oid ?? '?' }}</code>
      <span class="subj">{{ source?.summary ?? '' }}</span>
    </div>
    <div v-if="actionState.sourceBranchNames.length > 0" class="sub">
      {{ t('drag.dialog.onBranches', { list: actionState.sourceBranchNames.join(', ') }) }}
    </div>
    <div class="line">
      <span class="label">{{ t('drag.dialog.droppedCommit') }}</span>
      <code>{{ target?.short_oid ?? '?' }}</code>
      <span class="subj">{{ target?.summary ?? '' }}</span>
    </div>
    <div v-if="actionState.targetBranchNames.length > 0" class="sub">
      {{ t('drag.dialog.onBranches', { list: actionState.targetBranchNames.join(', ') }) }}
    </div>

    <p class="question">{{ t('drag.dialog.question') }}</p>

    <div class="actions">
      <button
        class="btn btn-primary"
        :disabled="!actionState.canMerge"
        :title="mergeDisabledText"
        @click="emit('merge')"
      >
        {{ t('drag.dialog.merge', { source: mergeSourceLabel, branch: currentBranchLabel }) }}
      </button>
      <button
        class="btn btn-primary"
        :disabled="!actionState.canRebase"
        :title="rebaseDisabledText"
        @click="emit('rebase')"
      >
        {{ t('drag.dialog.rebase', { branch: currentBranchLabel }) }}
      </button>
      <button class="btn btn-secondary" @click="emit('close')">
        {{ t('common.cancel') }}
      </button>
    </div>
    <div v-if="mergeDisabledText || rebaseDisabledText" class="action-hints">
      <div v-if="mergeDisabledText">{{ t('drag.dialog.mergeUnavailable', { reason: mergeDisabledText }) }}</div>
      <div v-if="rebaseDisabledText">{{ t('drag.dialog.rebaseUnavailable', { reason: rebaseDisabledText }) }}</div>
    </div>
  </Modal>
</template>

<style scoped>
.line {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
  font-size: var(--font-md);
}

.label {
  color: var(--text-secondary);
  width: 86px;
  flex: 0 0 86px;
  text-align: right;
}

code {
  font-family: var(--font-mono, monospace);
  color: var(--accent-blue);
}

.subj {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub {
  margin: 0 0 8px 58px;
  font-size: var(--font-sm);
  color: var(--text-muted, var(--text-secondary));
}

.question {
  margin: 16px 0 10px;
  font-size: var(--font-md);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.actions .btn {
  min-height: 30px;
  white-space: normal;
}

.action-hints {
  margin-top: 8px;
  padding-left: 94px;
  font-size: var(--font-sm);
  color: var(--text-muted, var(--text-secondary));
  line-height: 1.5;
}

</style>
