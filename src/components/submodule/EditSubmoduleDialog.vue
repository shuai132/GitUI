<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SubmoduleInfo } from '@/types/git'
import Modal from '@/components/common/Modal.vue'
import { useSubmodulesStore } from '@/stores/submodules'

const { t } = useI18n()

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
  <Modal :visible="visible" :title="t('submodule.edit.title')" width="520px" @close="onCancel">
    <div v-if="submodule" class="form-row">
      <label class="form-label">{{ t('submodule.edit.nameLabel') }}</label>
      <div class="readonly-value">{{ submodule.name }}</div>
    </div>

    <div v-if="submodule" class="form-row">
      <label class="form-label">{{ t('submodule.edit.pathLabel') }}</label>
      <div class="readonly-value">{{ submodule.path }}</div>
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('submodule.edit.urlLabel') }}</label>
      <input
        v-model="url"
        class="form-control"
        type="text"
        :placeholder="t('submodule.edit.urlPlaceholder')"
        spellcheck="false"
        autocomplete="off"
      />
    </div>

    <div class="hint">
      {{ t('submodule.edit.hintPart1') }}<code>.gitmodules</code>{{ t('submodule.edit.hintPart2') }}<code>.git/config</code>{{ t('submodule.edit.hintPart3') }}
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>

    <template #footer>
      <button class="btn btn-secondary" @click="onCancel">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" :disabled="!canSubmit" @click="onSave">
        {{ submitting ? t('submodule.edit.submitting') : t('submodule.edit.submit') }}
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
  font-size: var(--font-md);
  color: var(--text-secondary);
  text-align: right;
}

.readonly-value {
  font-size: var(--font-md);
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
  font-size: var(--font-md);
  padding: 5px 8px;
  outline: none;
  width: 100%;
}

.form-control:focus {
  border-color: var(--accent-blue);
}

.hint {
  grid-column: 1 / -1;
  font-size: var(--font-sm);
  color: var(--text-muted);
  margin-top: 4px;
  margin-bottom: 8px;
  line-height: 1.5;
}

.hint code {
  background: var(--bg-overlay);
  padding: 0 4px;
  border-radius: 3px;
  font-size: var(--font-xs);
}

.form-error {
  color: var(--accent-red);
  font-size: var(--font-sm);
  margin-top: 4px;
  margin-bottom: 8px;
}

.btn {
  padding: 6px 18px;
  border-radius: 5px;
  font-family: inherit;
  font-size: var(--font-md);
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
