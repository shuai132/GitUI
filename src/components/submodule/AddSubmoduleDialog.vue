<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from '@/stores/repos'

const { t } = useI18n()
const { addSubmodule } = useGitCommands()
const repoStore = useRepoStore()

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const url = ref('')
const path = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    url.value = ''
    path.value = ''
    submitting.value = false
    error.value = null
  },
)

// 从 URL 自动推导默认 path（取最后一个路径段，去掉 .git 后缀）
watch(url, (newUrl) => {
  if (path.value) return  // 用户已手动填写，不覆盖
  const match = newUrl.trim().replace(/\/+$/, '').match(/([^/]+?)(\.git)?$/)
  if (match) {
    path.value = match[1]
  }
})

const canSubmit = computed(
  () => !!url.value.trim() && !!path.value.trim() && !submitting.value,
)

async function onSubmit() {
  if (!canSubmit.value) return
  const repoId = repoStore.activeRepoId
  if (!repoId) return
  submitting.value = true
  error.value = null
  try {
    await addSubmodule(repoId, url.value.trim(), path.value.trim())
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
  <Modal :visible="visible" :title="t('submodule.add.title')" width="500px" @close="onCancel">
    <div class="form-row">
      <label class="form-label">{{ t('submodule.add.urlLabel') }}</label>
      <input
        v-model="url"
        class="form-control"
        type="text"
        :placeholder="t('submodule.add.urlPlaceholder')"
        spellcheck="false"
        autocomplete="off"
      />
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('submodule.add.pathLabel') }}</label>
      <input
        v-model="path"
        class="form-control"
        type="text"
        :placeholder="t('submodule.add.pathPlaceholder')"
        spellcheck="false"
        autocomplete="off"
        @keydown.enter="onSubmit"
      />
    </div>

    <p class="hint">{{ t('submodule.add.hint') }}</p>

    <div v-if="error" class="form-error">{{ error }}</div>

    <template #footer>
      <button class="btn btn-secondary" @click="onCancel">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" :disabled="!canSubmit" @click="onSubmit">
        {{ submitting ? t('submodule.add.submitting') : t('submodule.add.submit') }}
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

.hint {
  font-size: var(--font-sm);
  color: var(--text-muted);
  margin: 0 0 8px;
  line-height: 1.5;
}

.form-error {
  color: var(--accent-red);
  font-size: var(--font-sm);
  margin-top: 4px;
  margin-bottom: 8px;
}
</style>
