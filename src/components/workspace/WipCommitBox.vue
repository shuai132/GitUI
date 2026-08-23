<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { bindingToLabel, matchesBinding, useShortcutsStore } from '@/stores/shortcuts'
import { useHistoryStore } from '@/stores/history'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  isUnborn: boolean
  stagedCount: number
}>()

const { t } = useI18n()
const workspaceStore = useWorkspaceStore()
const uiStore = useUiStore()
const historyStore = useHistoryStore()
const shortcutsStore = useShortcutsStore()

const amendChecked = ref(false)
const message = computed({
  get: () => workspaceStore.commitDraft,
  set: (v: string) => {
    workspaceStore.commitDraft = v
  },
})
const committing = ref(false)
const commitError = ref<string | null>(null)
const messageInputRef = ref<HTMLTextAreaElement | null>(null)

watch(
  () => uiStore.focusCommitMessageSignal,
  async () => {
    await nextTick()
    const input = messageInputRef.value
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  },
)

const canCommit = computed(() => {
  if (committing.value) return false
  if (message.value.trim().length === 0) return false
  if (amendChecked.value) return !props.isUnborn
  return props.stagedCount > 0
})

const commitButtonLabel = computed(() => {
  if (committing.value) return t('workspace.commit.button.committing')
  if (amendChecked.value) return t('workspace.commit.button.amend')
  if (props.stagedCount === 0) return t('workspace.commit.button.stageFirst')
  return t('workspace.commit.button.commitCount', { count: props.stagedCount })
})

watch(amendChecked, (checked) => {
  const headMsg = workspaceStore.status?.head_commit_message ?? ''
  if (checked) {
    if (message.value.trim() === '') {
      message.value = headMsg
    }
  } else if (message.value === headMsg) {
    message.value = ''
  }
  nextTick(autoResizeInput)
})

async function onCommit() {
  if (!canCommit.value) return
  committing.value = true
  commitError.value = null
  try {
    const msg = message.value.trim()
    const oid = amendChecked.value
      ? await workspaceStore.amend(msg)
      : await workspaceStore.commit(msg)
    amendChecked.value = false
    await historyStore.loadLog()
    await historyStore.loadBranches()
    if (oid) {
      historyStore.selectCommit(oid)
    }
  } catch (e) {
    commitError.value = String(e)
  } finally {
    committing.value = false
  }
}

function onMessageKeydown(e: KeyboardEvent) {
  if (matchesBinding(e, shortcutsStore.bindings.commit)) {
    e.preventDefault()
    onCommit()
  }
}

function autoResizeInput() {
  const el = messageInputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}
</script>

<template>
  <div class="commit-form">
    <textarea
      ref="messageInputRef"
      v-model="message"
      class="message-input"
      rows="1"
      wrap="off"
      :placeholder="t('workspace.commit.messagePlaceholder')"
      spellcheck="false"
      autocomplete="off"
      @keydown="onMessageKeydown"
      @input="autoResizeInput"
    />
    <div class="commit-actions">
      <label class="amend-row" :title="t('workspace.commit.amendLabel')">
        <input
          v-model="amendChecked"
          type="checkbox"
          :disabled="isUnborn"
        >
        <span>Amend</span>
      </label>
      <button
        class="btn-commit"
        :disabled="!canCommit"
        :title="shortcutsStore.bindings.commit ? bindingToLabel(shortcutsStore.bindings.commit) : undefined"
        @click="onCommit"
      >
        {{ commitButtonLabel }}
      </button>
    </div>
    <div v-if="commitError" class="commit-error">{{ commitError }}</div>
  </div>
</template>

<style scoped>
.commit-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
  flex-shrink: 0;
  overflow: hidden;
}

.commit-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: space-between;
}

.amend-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}

.amend-row input[type='checkbox'] {
  cursor: pointer;
  accent-color: var(--accent-blue);
}

.amend-row input:disabled {
  cursor: not-allowed;
}

.message-input {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-md);
  padding: 4px 8px;
  outline: none;
  transition: border-color 0.15s;
  resize: none;
  overflow-x: auto;
  scrollbar-width: none;
  overflow-y: hidden;
  line-height: 1.4;
  max-height: 120px;
}

.message-input:focus {
  border-color: var(--accent-blue);
}

.message-input::-webkit-scrollbar {
  display: none;
}

.commit-error {
  font-size: var(--font-sm);
  color: var(--accent-red);
}

.btn-commit {
  background: var(--accent-blue);
  color: var(--bg-primary);
  border: none;
  border-radius: 4px;
  padding: 4px 14px;
  font-size: var(--font-md);
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  flex-shrink: 0;
  white-space: nowrap;
}

.btn-commit:hover:not(:disabled) {
  opacity: 0.85;
}

.btn-commit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
