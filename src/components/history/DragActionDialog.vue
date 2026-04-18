<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'
import { useHistoryStore } from '@/stores/history'

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

function commitInfo(oid: string | null) {
  if (!oid) return null
  return historyStore.commits.find((c) => c.oid === oid) ?? null
}

const source = computed(() => commitInfo(props.sourceOid))
const target = computed(() => commitInfo(props.targetOid))

/** 从 commit oid 解析所属本地分支（若指向的是 tip）。返回名字列表。 */
function branchesAt(oid: string | null) {
  if (!oid) return []
  return historyStore.branches
    .filter((b) => !b.is_remote && b.commit_oid === oid)
    .map((b) => b.name)
}
</script>

<template>
  <Modal
    :visible="visible"
    :title="t('drag.dialog.title')"
    width="520px"
    @close="emit('close')"
  >
    <div class="line">
      <span class="label">{{ t('drag.dialog.source') }}</span>
      <code>{{ source?.short_oid ?? '?' }}</code>
      <span class="subj">{{ source?.summary ?? '' }}</span>
    </div>
    <div v-if="branchesAt(sourceOid).length > 0" class="sub">
      {{ t('drag.dialog.onBranches', { list: branchesAt(sourceOid).join(', ') }) }}
    </div>
    <div class="line">
      <span class="label">{{ t('drag.dialog.target') }}</span>
      <code>{{ target?.short_oid ?? '?' }}</code>
      <span class="subj">{{ target?.summary ?? '' }}</span>
    </div>
    <div v-if="branchesAt(targetOid).length > 0" class="sub">
      {{ t('drag.dialog.onBranches', { list: branchesAt(targetOid).join(', ') }) }}
    </div>

    <p class="question">{{ t('drag.dialog.question') }}</p>

    <div class="actions">
      <button class="btn btn-primary" @click="emit('merge')">
        {{ t('drag.dialog.merge') }}
      </button>
      <button class="btn btn-primary" @click="emit('rebase')">
        {{ t('drag.dialog.rebase') }}
      </button>
      <button class="btn btn-secondary" @click="emit('close')">
        {{ t('common.cancel') }}
      </button>
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
  width: 50px;
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
  gap: 8px;
  justify-content: flex-end;
}

</style>
