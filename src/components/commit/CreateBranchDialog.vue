<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommitInfo } from '@/types/git'
import Modal from '@/components/common/Modal.vue'
import { useHistoryStore } from '@/stores/history'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  commit: CommitInfo | null
}>()

const emit = defineEmits<{
  close: []
}>()

const historyStore = useHistoryStore()

const branchName = ref('')
const switchAfterCreate = ref(true)
const submitting = ref(false)
const error = ref<string | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)

/** 已有本地分支名集合，用于冲突检测 */
const existingLocalNames = computed(() => {
  return new Set(
    historyStore.branches.filter((b) => !b.is_remote).map((b) => b.name),
  )
})

const nameConflict = computed(
  () => !!branchName.value.trim() && existingLocalNames.value.has(branchName.value.trim()),
)

const canSubmit = computed(
  () =>
    !!branchName.value.trim() &&
    !nameConflict.value &&
    !submitting.value,
)

// 弹窗打开时重置状态 + 自动聚焦
watch(
  () => props.visible,
  async (v) => {
    if (!v) return
    branchName.value = ''
    switchAfterCreate.value = true
    error.value = null
    submitting.value = false
    await nextTick()
    inputEl.value?.focus()
  },
  { immediate: true },
)

async function onSubmit() {
  if (!canSubmit.value) return
  const name = branchName.value.trim()
  submitting.value = true
  error.value = null
  try {
    // commit=null → 基于当前 HEAD 创建分支
    await historyStore.createBranch(name, props.commit?.oid)
    if (switchAfterCreate.value) {
      await historyStore.switchBranch(name)
    }
    emit('close')
  } catch (e: unknown) {
    error.value = String(e)
  } finally {
    submitting.value = false
  }
}

function onCancel() {
  emit('close')
}
</script>

<template>
  <Modal
    :visible="visible"
    :title="commit ? t('branch.create.titleOnCommit') : t('branch.create.titleFromHead')"
    width="460px"
    @close="onCancel"
  >
    <div v-if="commit" class="commit-hint">
      {{ t('branch.create.hintOnCommitPrefix') }}
      <span class="hint-sha">{{ commit.short_oid }}</span>
      <span class="hint-summary">{{ commit.summary }}</span>
      {{ t('branch.create.hintOnCommitSuffix') }}
    </div>
    <div v-else class="commit-hint">
      {{ t('branch.create.hintFromHead') }}
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('branch.create.nameLabel') }}</label>
      <input
        ref="inputEl"
        v-model="branchName"
        class="form-control"
        type="text"
        :placeholder="t('branch.create.namePlaceholder')"
        spellcheck="false"
        autocomplete="off"
        @keydown.enter="onSubmit"
      />
    </div>

    <div class="form-row form-row--offset">
      <label class="checkbox-label">
        <input v-model="switchAfterCreate" type="checkbox" />
        <span>{{ t('branch.create.switchAfter') }}</span>
      </label>
    </div>

    <div v-if="nameConflict" class="form-error">
      {{ t('branch.create.errorNameConflict', { name: branchName.trim() }) }}
    </div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <template #footer>
      <button class="btn btn-secondary" @click="onCancel">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" :disabled="!canSubmit" @click="onSubmit">
        {{ submitting ? t('branch.create.submitting') : t('branch.create.submit') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.commit-hint {
  font-size: var(--font-md);
  color: var(--text-secondary);
  margin-bottom: 14px;
  padding: 8px 10px;
  background: var(--bg-overlay);
  border-radius: 5px;
  line-height: 1.6;
}

.hint-sha {
  font-family: var(--font-mono, monospace);
  color: var(--accent-blue);
  margin: 0 6px;
  font-weight: 600;
}

.hint-summary {
  color: var(--text-primary);
  margin-left: 6px;
}

.form-row {
  display: grid;
  grid-template-columns: 100px 1fr;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.form-row--offset {
  grid-template-columns: 100px 1fr;
}

.form-label {
  font-size: var(--font-md);
  color: var(--text-secondary);
  text-align: right;
}

.form-control {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-md);
  padding: 5px 8px;
  outline: none;
  width: 100%;
}

.form-control:focus {
  border-color: var(--accent-blue);
}

.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-md);
  color: var(--text-secondary);
  cursor: pointer;
  grid-column: 2;
}

.checkbox-label input[type='checkbox'] {
  cursor: pointer;
  accent-color: var(--accent-blue);
}

.form-error {
  color: var(--accent-red);
  font-size: var(--font-sm);
  margin-top: -4px;
  margin-bottom: 8px;
  padding-left: 110px;
}

</style>
