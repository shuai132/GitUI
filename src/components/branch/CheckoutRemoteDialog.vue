<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BranchInfo } from '@/types/git'
import Modal from '@/components/common/Modal.vue'
import { useHistoryStore } from '@/stores/history'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  remoteBranches: BranchInfo[]
  initialRemote?: string | null
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const historyStore = useHistoryStore()

const selectedRemote = ref<string>('')
const localName = ref<string>('')
const track = ref<boolean>(true)
const submitting = ref<boolean>(false)
const error = ref<string | null>(null)

/** 已有的本地分支名集合，用于本地名冲突检测 */
const existingLocalNames = computed(() => {
  return new Set(
    historyStore.branches
      .filter((b) => !b.is_remote)
      .map((b) => b.name),
  )
})

/** 从远程分支 origin/copilot/foo 去掉第一段得到 copilot/foo */
function stripRemotePrefix(fullName: string): string {
  const idx = fullName.indexOf('/')
  return idx >= 0 ? fullName.slice(idx + 1) : fullName
}

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    // 重置状态
    error.value = null
    submitting.value = false
    const initial =
      props.initialRemote ??
      props.remoteBranches.find((b) => !b.name.endsWith('/HEAD'))?.name ??
      ''
    selectedRemote.value = initial
  },
  { immediate: true },
)

// 选择远程分支时自动填充本地名
watch(selectedRemote, (v) => {
  localName.value = stripRemotePrefix(v)
})

const canSubmit = computed(
  () =>
    !!selectedRemote.value &&
    !!localName.value.trim() &&
    !existingLocalNames.value.has(localName.value.trim()) &&
    !submitting.value,
)

async function onCheckout() {
  if (!canSubmit.value) return
  submitting.value = true
  error.value = null
  try {
    await historyStore.checkoutRemoteBranch(
      selectedRemote.value,
      localName.value.trim(),
      track.value,
    )
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
  <Modal :visible="visible" :title="t('branch.checkoutRemote.title')" width="480px" @close="onCancel">
    <div class="form-row">
      <label class="form-label">{{ t('branch.checkoutRemote.remoteLabel') }}</label>
      <select v-model="selectedRemote" class="form-control">
        <option
          v-for="b in remoteBranches"
          :key="b.name"
          :value="b.name"
          :disabled="b.name.endsWith('/HEAD')"
        >
          {{ b.name }}
        </option>
      </select>
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('branch.checkoutRemote.localNameLabel') }}</label>
      <input
        v-model="localName"
        class="form-control"
        type="text"
        spellcheck="false"
        autocomplete="off"
      />
    </div>

    <div class="form-row form-row--offset">
      <label class="checkbox-label">
        <input v-model="track" type="checkbox" />
        <span>{{ t('branch.checkoutRemote.track') }}</span>
      </label>
    </div>

    <div
      v-if="localName && existingLocalNames.has(localName.trim())"
      class="form-error"
    >
      {{ t('branch.checkoutRemote.errorNameConflict', { name: localName }) }}
    </div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <template #footer>
      <button class="btn btn-secondary" @click="onCancel">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" :disabled="!canSubmit" @click="onCheckout">
        {{ submitting ? t('branch.checkoutRemote.submitting') : t('branch.checkoutRemote.submit') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.form-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.form-row--offset {
  grid-template-columns: 140px 1fr;
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

.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-md);
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
  font-size: var(--font-sm);
  margin-top: -4px;
  margin-bottom: 8px;
  grid-column: 2;
}

</style>
