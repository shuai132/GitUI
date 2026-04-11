<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import type { CommitInfo } from '@/types/git'
import Modal from '@/components/common/Modal.vue'
import { useHistoryStore } from '@/stores/history'

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
    :title="commit ? '在此提交上创建分支' : '基于 HEAD 创建分支'"
    width="460px"
    @close="onCancel"
  >
    <div v-if="commit" class="commit-hint">
      在提交
      <span class="hint-sha">{{ commit.short_oid }}</span>
      <span class="hint-summary">{{ commit.summary }}</span>
      上创建新分支
    </div>
    <div v-else class="commit-hint">
      基于当前 HEAD 创建新分支
    </div>

    <div class="form-row">
      <label class="form-label">分支名称：</label>
      <input
        ref="inputEl"
        v-model="branchName"
        class="form-control"
        type="text"
        placeholder="例如：feature/my-branch"
        @keydown.enter="onSubmit"
      />
    </div>

    <div class="form-row form-row--offset">
      <label class="checkbox-label">
        <input v-model="switchAfterCreate" type="checkbox" />
        <span>创建后立即切换到此分支</span>
      </label>
    </div>

    <div v-if="nameConflict" class="form-error">
      本地已存在同名分支 "{{ branchName.trim() }}"
    </div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <template #footer>
      <button class="btn btn-secondary" @click="onCancel">取消</button>
      <button class="btn btn-primary" :disabled="!canSubmit" @click="onSubmit">
        {{ submitting ? '创建中...' : '创建' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.commit-hint {
  font-size: 12px;
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
  font-size: 12px;
  color: var(--text-secondary);
  text-align: right;
}

.form-control {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12px;
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
  font-size: 12px;
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
  font-size: 11px;
  margin-top: -4px;
  margin-bottom: 8px;
  padding-left: 110px;
}

.btn {
  padding: 6px 18px;
  border-radius: 5px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.btn-secondary {
  background: var(--bg-overlay);
  color: var(--text-primary);
  border-color: var(--border);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-primary);
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
