<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'
import { useRepoStore } from '@/stores/repos'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const repoStore = useRepoStore()

const parentDir = ref('')
const dirName = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)
const nameInputEl = ref<HTMLInputElement | null>(null)

const nameInvalid = computed(() => /[\\/]/.test(dirName.value))

const finalPath = computed(() => {
  const name = dirName.value.trim()
  if (!parentDir.value || !name) return ''
  const sep = parentDir.value.includes('\\') ? '\\' : '/'
  return parentDir.value.replace(/[\/\\]+$/, '') + sep + name
})

const canSubmit = computed(() => {
  return (
    !!parentDir.value &&
    !!dirName.value.trim() &&
    !nameInvalid.value &&
    !submitting.value
  )
})

watch(
  () => props.visible,
  async (v) => {
    if (!v) return
    parentDir.value = ''
    dirName.value = ''
    submitting.value = false
    error.value = null
    await nextTick()
    nameInputEl.value?.focus()
  },
  { immediate: true },
)

async function onPickParentDir() {
  try {
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
    const selected = await openDialog({ directory: true })
    if (typeof selected === 'string') {
      parentDir.value = selected
    }
  } catch (e) {
    console.error(e)
  }
}

async function onSubmit() {
  if (!canSubmit.value) return
  if (!parentDir.value) {
    error.value = t('repo.init.errors.parentRequired')
    return
  }
  if (!dirName.value.trim()) {
    error.value = t('repo.init.errors.nameRequired')
    return
  }
  if (nameInvalid.value) {
    error.value = t('repo.init.errors.nameInvalid')
    return
  }

  submitting.value = true
  error.value = null
  try {
    await repoStore.initRepo(finalPath.value)
    emit('close')
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    submitting.value = false
  }
}

function onCancel() {
  if (submitting.value) return
  emit('close')
}
</script>

<template>
  <Modal
    :visible="visible"
    :title="t('repo.init.title')"
    width="480px"
    @close="onCancel"
  >
    <div class="form-row">
      <label class="form-label">{{ t('repo.init.parentDirLabel') }}</label>
      <div class="path-picker">
        <input
          v-model="parentDir"
          class="form-control"
          type="text"
          :placeholder="t('repo.init.parentDirPlaceholder')"
          spellcheck="false"
          :disabled="submitting"
        />
        <button
          type="button"
          class="btn btn-secondary btn-pick"
          :disabled="submitting"
          @click="onPickParentDir"
        >
          {{ t('repo.init.chooseDir') }}
        </button>
      </div>
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('repo.init.nameLabel') }}</label>
      <input
        ref="nameInputEl"
        v-model="dirName"
        class="form-control"
        type="text"
        :placeholder="t('repo.init.namePlaceholder')"
        spellcheck="false"
        autocomplete="off"
        :disabled="submitting"
        @keydown.enter="onSubmit"
      />
    </div>

    <div v-if="finalPath" class="final-path">
      <span class="final-path-label">{{ t('repo.init.finalPathLabel') }}</span>
      <span class="final-path-value">{{ finalPath }}</span>
    </div>

    <div class="hint">{{ t('repo.init.hint') }}</div>

    <div v-if="nameInvalid" class="form-error">
      {{ t('repo.init.errors.nameInvalid') }}
    </div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <template #footer>
      <button class="btn btn-secondary" :disabled="submitting" @click="onCancel">
        {{ t('common.cancel') }}
      </button>
      <button class="btn btn-primary" :disabled="!canSubmit" @click="onSubmit">
        {{ submitting ? t('repo.init.submitting') : t('repo.init.submit') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.form-row {
  display: grid;
  grid-template-columns: 90px 1fr;
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

.form-control:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.path-picker {
  display: flex;
  gap: 8px;
}

.btn-pick {
  flex-shrink: 0;
  padding: 5px 12px;
  font-size: var(--font-md);
}

.final-path {
  margin: 8px 0 4px;
  padding: 6px 10px;
  background: var(--bg-overlay);
  border-radius: 4px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  word-break: break-all;
}

.final-path-label {
  margin-right: 6px;
}

.final-path-value {
  color: var(--text-primary);
  font-family: var(--font-mono, monospace);
}

.hint {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.form-error {
  color: var(--accent-red);
  font-size: var(--font-sm);
  margin-top: 6px;
  padding-left: 100px;
  word-break: break-all;
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
