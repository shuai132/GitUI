<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  title: string
  message: string
  confirmLabel?: string
  loadingLabel?: string
  danger?: boolean
  loading?: boolean
  checkboxLabel?: string
  checkboxValue?: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
  'update:checkboxValue': [val: boolean]
}>()

function onConfirm() {
  if (props.loading) return
  emit('confirm')
}

function onCancel() {
  emit('cancel')
}
</script>

<template>
  <Modal :visible="visible" :title="title" width="420px" @close="onCancel">
    <p class="confirm-message">{{ message }}</p>

    <div v-if="checkboxLabel" class="confirm-checkbox">
      <label class="checkbox-container">
        <input
          type="checkbox"
          :checked="checkboxValue"
          @change="emit('update:checkboxValue', ($event.target as HTMLInputElement).checked)"
        >
        <span class="checkbox-label">{{ checkboxLabel }}</span>
      </label>
    </div>

    <template #footer>
      <button class="btn btn-secondary" :disabled="loading" @click="onCancel">
        {{ t('common.cancel') }}
      </button>
      <button
        class="btn"
        :class="danger ? 'btn-danger' : 'btn-primary'"
        :disabled="loading"
        @click="onConfirm"
      >
        {{ loading ? (loadingLabel ?? t('common.loading')) : (confirmLabel ?? t('common.confirm')) }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.confirm-message {
  font-size: var(--font-md);
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
  white-space: pre-wrap;
}

.confirm-checkbox {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.checkbox-container {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.checkbox-label {
  font-size: var(--font-sm);
  color: var(--text-primary);
}
</style>
