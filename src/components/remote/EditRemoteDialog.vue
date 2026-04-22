<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from '@/stores/repos'

import type { RemoteInfo } from '@/types/git'

const { t } = useI18n()
const { editRemote } = useGitCommands()
const repoStore = useRepoStore()

const props = defineProps<{
  visible: boolean
  target: RemoteInfo | null
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const name = ref('')
const url = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    name.value = props.target?.name ?? ''
    url.value = props.target?.url ?? ''
    submitting.value = false
    error.value = null
  },
)

const canSubmit = computed(
  () => !!name.value.trim() && !!url.value.trim() && !submitting.value,
)

async function onSubmit() {
  if (!canSubmit.value) return
  const repoId = repoStore.activeRepoId
  if (!repoId || !props.target) return
  submitting.value = true
  error.value = null
  try {
    await editRemote(repoId, props.target.name, name.value.trim(), url.value.trim())
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
  <Modal :visible="visible" :title="t('remote.edit.title', 'Edit Remote')" width="500px" @close="onCancel">
    <div class="form-row">
      <label class="form-label">{{ t('remote.add.nameLabel') }}</label>
      <input
        v-model="name"
        class="form-control"
        type="text"
        :placeholder="t('remote.add.namePlaceholder')"
        spellcheck="false"
        autocomplete="off"
        @keydown.enter="onSubmit"
      />
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('remote.add.urlLabel') }}</label>
      <input
        v-model="url"
        class="form-control"
        type="text"
        :placeholder="t('remote.add.urlPlaceholder')"
        spellcheck="false"
        autocomplete="off"
        @keydown.enter="onSubmit"
      />
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>

    <template #footer>
      <button class="btn btn-secondary" @click="onCancel">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" :disabled="!canSubmit" @click="onSubmit">
        {{ submitting ? t('common.saving', 'Saving...') : t('common.save', 'Save') }}
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

.form-error {
  color: var(--accent-red);
  font-size: var(--font-sm);
  margin-top: 4px;
  margin-bottom: 8px;
}
</style>
