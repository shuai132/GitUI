<script setup lang="ts">
import { ref, computed } from 'vue'
import { useHistoryStore } from '@/stores/history'
import { useWorkspaceStore } from '@/stores/workspace'

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
  if (confirm(`确认删除分支 "${name}"？`)) {
    await historyStore.deleteBranch(name)
  }
}
</script>

<template>
  <div class="branch-list">
    <div class="branch-actions">
      <button class="btn-new" @click="showNewBranch = !showNewBranch">
        + 新建分支
      </button>
    </div>

    <div v-if="showNewBranch" class="new-branch-form">
      <input
        v-model="newBranchName"
        class="branch-input"
        placeholder="分支名称"
        spellcheck="false"
        autocomplete="off"
        @keydown.enter="createBranch"
      />
      <button class="btn-create" @click="createBranch">创建</button>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <div class="branch-section">
      <div class="section-title">本地分支</div>
      <div
        v-for="branch in localBranches"
        :key="branch.name"
        class="branch-item"
        :class="{ current: branch.is_head }"
      >
        <span class="branch-indicator" v-if="branch.is_head">*</span>
        <span class="branch-name" @click="!branch.is_head && switchBranch(branch.name)">
          {{ branch.name }}
          <span v-if="switchingTo === branch.name" class="switching">切换中...</span>
        </span>
        <button
          v-if="!branch.is_head"
          class="btn-delete"
          @click.stop="deleteBranch(branch.name)"
          title="删除分支"
        >×</button>
      </div>
    </div>

    <div class="branch-section" v-if="remoteBranches.length > 0">
      <div class="section-title">远程分支</div>
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
  font-size: 12px;
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
  font-size: 12px;
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
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  font-weight: 600;
}

.error-msg {
  padding: 8px 12px;
  color: var(--accent-red);
  font-size: 11px;
}

.branch-section {
  padding: 8px 0;
}

.section-title {
  padding: 4px 12px 6px;
  font-size: 11px;
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
  font-size: 12px;
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
  font-size: 10px;
  color: var(--text-muted);
  margin-left: 6px;
}

.btn-delete {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
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
