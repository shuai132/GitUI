<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import {
  createDiscardPathPreview,
  type PendingWorkspaceDiscard,
} from '@/composables/workspace/workspaceDiscardConfirmation'

const props = defineProps<{
  request: PendingWorkspaceDiscard | null
  loading: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useI18n()

const title = computed(() => props.request?.kind === 'file'
  ? t('workspace.confirmDiscard.fileTitle')
  : t('workspace.confirmDiscard.selectedTitle'))

const message = computed(() => {
  const request = props.request
  if (!request) return ''
  if (request.kind === 'file') {
    return t('workspace.confirmDiscard.file', { file: request.paths[0] ?? '' })
  }

  const preview = createDiscardPathPreview(request.paths)
  const lines = [
    t('workspace.confirmDiscard.selected', { count: request.paths.length }),
    '',
    ...preview.visiblePaths.map((path) => `• ${path}`),
  ]
  if (preview.remainingCount > 0) {
    lines.push(t('workspace.confirmDiscard.selectedMore', {
      count: preview.remainingCount,
    }))
  }
  return lines.join('\n')
})
</script>

<template>
  <ConfirmDialog
    :visible="request !== null"
    :title="title"
    :message="message"
    :confirm-label="t('workspace.confirmDiscard.confirm')"
    :loading-label="t('workspace.confirmDiscard.running')"
    :loading="loading"
    danger
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
  />
</template>
