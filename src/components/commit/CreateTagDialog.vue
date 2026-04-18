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
  annotated: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const historyStore = useHistoryStore()

const tagName = ref('')
const tagMessage = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)
const nameInputEl = ref<HTMLInputElement | null>(null)

const title = computed(() =>
  props.annotated ? t('tag.create.titleAnnotated') : t('tag.create.title'),
)

const canSubmit = computed(() => {
  if (!props.commit || submitting.value) return false
  if (!tagName.value.trim()) return false
  if (props.annotated && !tagMessage.value.trim()) return false
  return true
})

watch(
  () => props.visible,
  async (v) => {
    if (!v) return
    tagName.value = ''
    tagMessage.value = ''
    error.value = null
    submitting.value = false
    await nextTick()
    nameInputEl.value?.focus()
  },
  { immediate: true },
)

async function onSubmit() {
  if (!canSubmit.value || !props.commit) return
  const name = tagName.value.trim()
  const message = props.annotated ? tagMessage.value.trim() : null
  submitting.value = true
  error.value = null
  try {
    await historyStore.createTag(name, props.commit.oid, message)
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
  <Modal :visible="visible" :title="title" width="480px" @close="onCancel">
    <div v-if="commit" class="commit-hint">
      {{ t('tag.create.hintOnCommitPrefix') }}
      <span class="hint-sha">{{ commit.short_oid }}</span>
      <span class="hint-summary">{{ commit.summary }}</span>
      {{ t('tag.create.hintOnCommitSuffix') }}
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('tag.create.nameLabel') }}</label>
      <input
        ref="nameInputEl"
        v-model="tagName"
        class="form-control"
        type="text"
        :placeholder="t('tag.create.namePlaceholder')"
        spellcheck="false"
        autocomplete="off"
        @keydown.enter="!annotated && onSubmit()"
      />
    </div>

    <div v-if="annotated" class="form-row form-row--top">
      <label class="form-label">{{ t('tag.create.messageLabel') }}</label>
      <textarea
        v-model="tagMessage"
        class="form-control form-textarea"
        rows="4"
        :placeholder="t('tag.create.messagePlaceholder')"
        spellcheck="false"
        autocomplete="off"
      />
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>

    <template #footer>
      <button class="btn btn-secondary" @click="onCancel">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" :disabled="!canSubmit" @click="onSubmit">
        {{ submitting ? t('tag.create.submitting') : t('tag.create.submit') }}
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

.form-row--top {
  align-items: flex-start;
}

.form-label {
  font-size: var(--font-md);
  color: var(--text-secondary);
  text-align: right;
  padding-top: 5px;
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

.form-textarea {
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
}

.form-error {
  color: var(--accent-red);
  font-size: var(--font-sm);
  margin-top: -4px;
  margin-bottom: 8px;
  padding-left: 110px;
}

</style>
