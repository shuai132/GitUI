<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
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
        {{ loading ? t('common.loading') : (confirmLabel ?? t('common.confirm')) }}
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
</style>
