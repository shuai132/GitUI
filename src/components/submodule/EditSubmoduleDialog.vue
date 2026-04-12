<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { SubmoduleInfo } from '@/types/git'
import Modal from '@/components/common/Modal.vue'
import { useSubmodulesStore } from '@/stores/submodules'

const props = defineProps<{
  visible: boolean
  submodule: SubmoduleInfo | null
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const submodulesStore = useSubmodulesStore()

const url = ref<string>('')
const submitting = ref<boolean>(false)
const error = ref<string | null>(null)

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    error.value = null
    submitting.value = false
    url.value = props.submodule?.url ?? ''
  },
  { immediate: true },
)

const canSubmit = computed(
  () =>
    !!props.submodule &&
    !!url.value.trim() &&
    url.value.trim() !== (props.submodule?.url ?? '') &&
    !submitting.value,
)

async function onSave() {
  if (!canSubmit.value || !props.submodule) return
  submitting.value = true
  error.value = null
  try {
    await submodulesStore.setUrl(props.submodule.name, url.value.trim())
    emit('success')
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
  <Modal :visible="visible" title="编辑 Submodule" width="520px" @close="onCancel">
    <div v-if="submodule" class="form-row">
      <label class="form-label">名称：</label>
      <div class="readonly-value">{{ submodule.name }}</div>
    </div>

    <div v-if="submodule" class="form-row">
      <label class="form-label">路径：</label>
      <div class="readonly-value">{{ submodule.path }}</div>
    </div>

    <div class="form-row">
      <label class="form-label">URL：</label>
      <input
        v-model="url"
        class="form-control"
        type="text"
        placeholder="https://example.com/repo.git"
        spellcheck="false"
        autocomplete="off"
      />
    </div>

    <div class="hint">
      修改后会写入 <code>.gitmodules</code>，已 init 的 submodule 会同步到
      <code>.git/config</code>。
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>

    <template #footer>
      <button class="btn btn-secondary" @click="onCancel">取消</button>
      <button class="btn btn-primary" :disabled="!canSubmit" @click="onSave">
        {{ submitting ? '保存中...' : '保存' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.form-row {
  display: grid;
  grid-template-columns: 80px 1fr;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.form-label {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: right;
}

.readonly-value {
  font-size: 12px;
  color: var(--text-primary);
  font-family: var(--font-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.hint {
  grid-column: 1 / -1;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
  margin-bottom: 8px;
  line-height: 1.5;
}

.hint code {
  background: var(--bg-overlay);
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
}

.form-error {
  color: var(--accent-red);
  font-size: 11px;
  margin-top: 4px;
  margin-bottom: 8px;
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
