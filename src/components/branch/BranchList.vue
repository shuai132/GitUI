<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHistoryStore } from '@/stores/history'
import { useWorkspaceStore } from '@/stores/workspace'

const { t } = useI18n()
const historyStore = useHistoryStore()
const workspaceStore = useWorkspaceStore()

const newBranchName = ref('')
const showNewBranch = ref(false)
const switchingTo = ref<string | null>(null)
const error = ref<string | null>(null)

const localBranches = computed(() =>
  historyStore.branches.filter((b) => !b.is_remote)
)
const remoteBranches = computed(() =>
  historyStore.branches.filter((b) => b.is_remote)
)

async function switchBranch(name: string) {
  switchingTo.value = name
  error.value = null
  try {
    await historyStore.switchBranch(name)
    await workspaceStore.refresh()
  } catch (e: unknown) {
    error.value = String(e)
  } finally {
    switchingTo.value = null
  }
}

async function createBranch() {
  if (!newBranchName.value.trim()) return
  error.value = null
  try {
    await historyStore.createBranch(newBranchName.value.trim())
    newBranchName.value = ''
    showNewBranch.value = false
  } catch (e: unknown) {
    error.value = String(e)
  }
}

async function deleteBranch(name: string) {
  if (confirm(t('branchList.confirmDelete', { name }))) {
    await historyStore.deleteBranch(name)
  }
}
</script>

<template>
  <div class="branch-list">
    <div class="branch-actions">
      <button class="btn-new" @click="showNewBranch = !showNewBranch">
        {{ t('branchList.newBranch') }}
      </button>
    </div>

    <div v-if="showNewBranch" class="new-branch-form">
      <input
        v-model="newBranchName"
        class="branch-input"
        :placeholder="t('branchList.namePlaceholder')"
        spellcheck="false"
        autocomplete="off"
        @keydown.enter="createBranch"
      />
      <button class="btn-create" @click="createBranch">{{ t('branchList.create') }}</button>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <div class="branch-section">
      <div class="section-title">{{ t('branchList.sectionLocal') }}</div>
      <div
        v-for="branch in localBranches"
        :key="branch.name"
        class="branch-item"
        :class="{ current: branch.is_head }"
      >
        <span class="branch-indicator" v-if="branch.is_head">*</span>
        <span class="branch-name" @click="!branch.is_head && switchBranch(branch.name)">
          {{ branch.name }}
          <span v-if="switchingTo === branch.name" class="switching">{{ t('branchList.switching') }}</span>
        </span>
        <button
          v-if="!branch.is_head"
          class="btn-delete"
          @click.stop="deleteBranch(branch.name)"
          :title="t('branchList.deleteTitle')"
        >×</button>
      </div>
    </div>

    <div class="branch-section" v-if="remoteBranches.length > 0">
      <div class="section-title">{{ t('branchList.sectionRemote') }}</div>
      <div
        v-for="branch in remoteBranches"
        :key="branch.name"
        class="branch-item remote"
      >
        <span class="branch-name">{{ branch.name }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.branch-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}

.branch-actions {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.btn-new {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  padding: 4px 10px;
  font-size: var(--font-md);
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-new:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.new-branch-form {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.branch-input {
  flex: 1;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-md);
  padding: 4px 8px;
  outline: none;
}

.branch-input:focus {
  border-color: var(--accent-blue);
}

.btn-create {
  background: var(--accent-blue);
  border: none;
  border-radius: 4px;
  color: var(--bg-primary);
  padding: 4px 10px;
  font-size: var(--font-md);
  font-family: inherit;
  cursor: pointer;
  font-weight: 600;
}

.error-msg {
  padding: 8px 12px;
  color: var(--accent-red);
  font-size: var(--font-sm);
}

.branch-section {
  padding: 8px 0;
}

.section-title {
  padding: 4px 12px 6px;
  font-size: var(--font-sm);
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.branch-item {
  display: flex;
  align-items: center;
  padding: 4px 12px;
  gap: 6px;
}

.branch-item:hover {
  background: var(--bg-overlay);
}

.branch-item.current {
  background: var(--bg-surface);
}

.branch-indicator {
  color: var(--accent-green);
  font-weight: bold;
  width: 12px;
}

.branch-name {
  flex: 1;
  font-size: var(--font-md);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-item.current .branch-name {
  color: var(--accent-green);
  cursor: default;
}

.branch-item.remote .branch-name {
  color: var(--text-secondary);
  cursor: default;
}

.switching {
  font-size: var(--font-xs);
  color: var(--text-muted);
  margin-left: 6px;
}

.btn-delete {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: var(--font-lg);
  padding: 0 4px;
  opacity: 0;
  transition: opacity 0.1s, color 0.1s;
}

.branch-item:hover .btn-delete {
  opacity: 1;
}

.btn-delete:hover {
  color: var(--accent-red);
}
</style>
