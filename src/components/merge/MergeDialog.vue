<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'
import { useMergeRebaseStore } from '@/stores/mergeRebase'
import { useHistoryStore } from '@/stores/history'
import type { MergeStrategy } from '@/types/git'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  /** 待合入的 commit oid（用于预填默认源） */
  sourceCommitOid: string | null
  /** 待合入的候选分支列表（由 HistoryView 根据 commit 关联的分支算出） */
  candidateSources: string[]
}>()

const emit = defineEmits<{ close: [] }>()

const mr = useMergeRebaseStore()
const historyStore = useHistoryStore()

const sourceBranch = ref('')
const strategy = ref<MergeStrategy>('auto')
const message = ref('')
const autoStash = ref(false)
const submitting = ref(false)
const errorMsg = ref<string | null>(null)

const targetBranch = computed(
  () =>
    historyStore.branches.find((b) => b.is_head && !b.is_remote)?.name ?? 'HEAD',
)

const sourceOptions = computed(() => {
  const set = new Set<string>()
  for (const name of props.candidateSources) set.add(name)
  // 候选不限于 props；本地所有分支都可作为源（除当前 HEAD）
  for (const b of historyStore.branches) {
    if (!b.is_remote && !b.is_head) set.add(b.name)
  }
  return Array.from(set)
})

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    sourceBranch.value = props.candidateSources[0] ?? sourceOptions.value[0] ?? ''
    strategy.value = 'auto'
    message.value = ''
    autoStash.value = false
    errorMsg.value = null
    submitting.value = false
  },
  { immediate: true },
)

const needsMessage = computed(() => strategy.value === 'no_fast_forward')

async function onSubmit() {
  if (!sourceBranch.value) return
  submitting.value = true
  errorMsg.value = null
  try {
    await mr.startMerge(
      sourceBranch.value,
      strategy.value,
      needsMessage.value && message.value.trim() ? message.value.trim() : null,
      autoStash.value,
    )
    emit('close')
  } catch (e) {
    errorMsg.value = String(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Modal
    :visible="visible"
    :title="t('merge.dialog.title')"
    width="520px"
    @close="emit('close')"
  >
    <div class="row">
      <label>{{ t('merge.dialog.source') }}</label>
      <select v-model="sourceBranch" class="input">
        <option v-for="n in sourceOptions" :key="n" :value="n">{{ n }}</option>
      </select>
    </div>
    <div class="row">
      <label>{{ t('merge.dialog.target') }}</label>
      <div class="static">{{ targetBranch }}</div>
    </div>
    <div class="row">
      <label>{{ t('merge.dialog.strategy') }}</label>
      <select v-model="strategy" class="input">
        <option value="auto">{{ t('merge.strategy.auto') }}</option>
        <option value="fast_forward">{{ t('merge.strategy.fastForward') }}</option>
        <option value="no_fast_forward">{{ t('merge.strategy.noFastForward') }}</option>
        <option value="squash">{{ t('merge.strategy.squash') }}</option>
      </select>
    </div>
    <div v-if="needsMessage" class="row row--stack">
      <label>{{ t('merge.dialog.message') }}</label>
      <textarea
        v-model="message"
        class="input"
        rows="4"
        :placeholder="t('merge.dialog.messagePlaceholder')"
      />
    </div>
    <div class="row">
      <label></label>
      <label class="checkbox">
        <input v-model="autoStash" type="checkbox" />
        <span>{{ t('merge.dialog.autoStash') }}</span>
      </label>
    </div>
    <div v-if="errorMsg" class="error">{{ errorMsg }}</div>

    <template #footer>
      <button class="btn btn-secondary" @click="emit('close')">
        {{ t('common.cancel') }}
      </button>
      <button
        class="btn btn-primary"
        :disabled="!sourceBranch || submitting"
        @click="onSubmit"
      >
        {{ submitting ? t('merge.dialog.submitting') : t('merge.dialog.submit') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}

.row--stack {
  grid-template-columns: 100px 1fr;
  align-items: start;
}

label {
  text-align: right;
  font-size: var(--font-md);
  color: var(--text-secondary);
}

.input,
.static {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  padding: 5px 8px;
  font-size: var(--font-md);
  font-family: inherit;
  width: 100%;
  outline: none;
}

.input:focus {
  border-color: var(--accent-blue);
}

.static {
  background: var(--bg-overlay);
  border-style: dashed;
}

textarea.input {
  font-family: var(--font-mono, monospace);
  resize: vertical;
}

.error {
  margin: 6px 0 0 110px;
  font-size: var(--font-sm);
  color: var(--accent-red);
}

.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-md);
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
}

.checkbox input[type='checkbox'] {
  cursor: pointer;
  accent-color: var(--accent-blue);
}

.btn {
  padding: 6px 18px;
  border-radius: 5px;
  font-size: var(--font-md);
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-overlay);
  color: var(--text-primary);
  border-color: var(--border);
}

.btn-primary {
  background: var(--accent-blue);
  color: var(--bg-primary);
  font-weight: 600;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}
</style>
