<script setup lang="ts">
import { ref, computed } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useHistoryStore } from '@/stores/history'

const workspaceStore = useWorkspaceStore()
const historyStore = useHistoryStore()

const message = ref('')
const committing = ref(false)
const error = ref<string | null>(null)

const canCommit = computed(() =>
  message.value.trim().length > 0 &&
  (workspaceStore.status?.staged.length ?? 0) > 0 &&
  !committing.value
)

async function doCommit() {
  if (!canCommit.value) return
  committing.value = true
  error.value = null
  try {
    await workspaceStore.commit(message.value.trim())
    await historyStore.loadLog()
    message.value = ''
  } catch (e: unknown) {
    error.value = String(e)
  } finally {
    committing.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    doCommit()
  }
}
</script>

<template>
  <div class="commit-panel">
    <textarea
      v-model="message"
      class="commit-message"
      placeholder="提交信息（Cmd+Enter 提交）"
      rows="4"
      spellcheck="false"
      autocomplete="off"
      @keydown="onKeydown"
    />
    <div v-if="error" class="error-msg">{{ error }}</div>
    <div class="commit-actions">
      <span class="staged-hint">
        {{ workspaceStore.status?.staged.length ?? 0 }} 个文件已暂存
      </span>
      <button
        class="btn-commit"
        :disabled="!canCommit"
        @click="doCommit"
      >
        {{ committing ? '提交中...' : '提交' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.commit-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
}

.commit-message {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12px;
  padding: 8px;
  resize: none;
  outline: none;
  transition: border-color 0.15s;
}

.commit-message:focus {
  border-color: var(--accent-blue);
}

.error-msg {
  color: var(--accent-red);
  font-size: 11px;
}

.commit-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.staged-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.btn-commit {
  background: var(--accent-blue);
  color: var(--bg-primary);
  border: none;
  border-radius: 4px;
  padding: 5px 16px;
  font-size: 12px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-commit:hover:not(:disabled) {
  opacity: 0.85;
}

.btn-commit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
