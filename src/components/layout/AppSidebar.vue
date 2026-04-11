<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useRepoStore } from '@/stores/repos'
import { useHistoryStore } from '@/stores/history'
import { useWorkspaceStore } from '@/stores/workspace'

const repoStore = useRepoStore()
const historyStore = useHistoryStore()
const workspaceStore = useWorkspaceStore()

// Changed files badge count
const changedCount = computed(() =>
  (workspaceStore.status?.staged.length ?? 0) +
  (workspaceStore.status?.unstaged.length ?? 0) +
  (workspaceStore.status?.untracked.length ?? 0)
)

// Local branches
const localBranches = computed(() =>
  historyStore.branches.filter((b) => !b.is_remote)
)

// Remote branches grouped by remote name
const remoteGroups = computed(() => {
  const groups: Record<string, typeof historyStore.branches> = {}
  for (const b of historyStore.branches.filter((b) => b.is_remote)) {
    const remote = b.name.split('/')[0] ?? 'origin'
    if (!groups[remote]) groups[remote] = []
    groups[remote].push(b)
  }
  return groups
})

const expandedRemotes = ref<Set<string>>(new Set(['origin']))

function toggleRemote(name: string) {
  if (expandedRemotes.value.has(name)) {
    expandedRemotes.value.delete(name)
  } else {
    expandedRemotes.value.add(name)
  }
}

async function openRepo() {
  try {
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
    const selected = await openDialog({ directory: true })
    if (selected) {
      await repoStore.openRepo(selected as string)
    }
  } catch (e) {
    console.error(e)
  }
}

async function switchBranch(name: string) {
  try {
    await historyStore.switchBranch(name)
  } catch (e) {
    console.error(e)
  }
}

function branchShortName(fullName: string): string {
  const parts = fullName.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : fullName
}
</script>

<template>
  <aside class="sidebar">
    <!-- Repo header -->
    <div class="repo-header">
      <div class="repo-name" :title="repoStore.activeRepo()?.path">
        {{ repoStore.activeRepo()?.name ?? '无仓库' }}
      </div>
      <button class="btn-add" title="添加仓库" @click="openRepo">+</button>
    </div>

    <div class="sidebar-scroll">
      <!-- WORKSPACE section -->
      <div class="section">
        <div class="section-title">WORKSPACE</div>

        <RouterLink to="/workspace" class="nav-item" active-class="nav-item--active">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span>文件变更</span>
          <span v-if="changedCount > 0" class="badge">{{ changedCount }}</span>
        </RouterLink>

        <RouterLink to="/history" class="nav-item" active-class="nav-item--active">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>历史</span>
        </RouterLink>
      </div>

      <!-- LOCAL BRANCHES section -->
      <div class="section" v-if="localBranches.length > 0 && repoStore.activeRepoId">
        <div class="section-title">LOCAL BRANCHES</div>
        <div
          v-for="b in localBranches"
          :key="b.name"
          class="branch-item"
          :class="{ 'branch-item--current': b.is_head }"
          @click="!b.is_head && switchBranch(b.name)"
        >
          <span class="branch-dot" :class="b.is_head ? 'dot-solid' : 'dot-outline'" />
          <span class="branch-label">{{ b.name }}</span>
        </div>
      </div>

      <!-- REMOTE sections -->
      <template v-for="(group, remoteName) in remoteGroups" :key="remoteName">
        <div class="section" v-if="repoStore.activeRepoId">
          <div class="section-title collapsible" @click="toggleRemote(remoteName as string)">
            <span>{{ (remoteName as string).toUpperCase() }}</span>
            <svg
              width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
              class="chevron"
              :class="{ open: expandedRemotes.has(remoteName as string) }"
            >
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
          <template v-if="expandedRemotes.has(remoteName as string)">
            <div
              v-for="b in group"
              :key="b.name"
              class="branch-item branch-item--remote"
            >
              <span class="branch-dot dot-outline dot-remote" />
              <span class="branch-label">{{ branchShortName(b.name) }}</span>
            </div>
          </template>
        </div>
      </template>
    </div>

    <!-- Bottom: additional repos -->
    <div class="repos-footer" v-if="repoStore.repos.length > 1">
      <div class="section-title">其他仓库</div>
      <div
        v-for="repo in repoStore.repos"
        :key="repo.id"
        class="repo-item"
        :class="{ 'repo-item--active': repo.id === repoStore.activeRepoId }"
        @click="repoStore.setActive(repo.id)"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>
        <span>{{ repo.name }}</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 220px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

/* ── Repo header ─────────────────────────────────────────────────── */
.repo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.repo-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-add {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 18px;
  line-height: 1;
  padding: 0 4px;
  border-radius: 3px;
  transition: color 0.15s;
}

.btn-add:hover {
  color: var(--text-primary);
}

/* ── Scrollable area ─────────────────────────────────────────────── */
.sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 8px;
}

/* ── Sections ────────────────────────────────────────────────────── */
.section {
  padding-top: 6px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 12px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  user-select: none;
}

.section-title.collapsible {
  cursor: pointer;
}

.section-title.collapsible:hover {
  color: var(--text-secondary);
}

.chevron {
  transition: transform 0.2s;
  transform: rotate(0deg);
}

.chevron.open {
  transform: rotate(90deg);
}

/* ── Nav items (RouterLink) ──────────────────────────────────────── */
.nav-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  text-decoration: none;
  border-left: 2px solid transparent;
  transition: background 0.1s, color 0.1s;
}

.nav-item:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.nav-item--active {
  background: rgba(138, 173, 244, 0.12);
  color: var(--accent-blue);
  border-left-color: var(--accent-blue);
}

.badge {
  margin-left: auto;
  background: var(--bg-overlay);
  color: var(--text-muted);
  font-size: 10px;
  border-radius: 8px;
  padding: 1px 6px;
}

/* ── Branch items ────────────────────────────────────────────────── */
.branch-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 12px 3px 16px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s;
}

.branch-item:hover {
  background: var(--bg-overlay);
}

.branch-item--current {
  color: var(--text-primary);
}

.branch-item--remote {
  color: var(--text-muted);
  cursor: default;
}

.branch-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-solid {
  background: var(--accent-blue);
}

.dot-outline {
  border: 1.5px solid var(--text-muted);
}

.dot-remote {
  border-color: var(--accent-orange);
  opacity: 0.7;
}

.branch-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Repos footer ────────────────────────────────────────────────── */
.repos-footer {
  border-top: 1px solid var(--border);
  padding-top: 4px;
  flex-shrink: 0;
}

.repo-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s;
}

.repo-item:hover {
  background: var(--bg-overlay);
}

.repo-item--active {
  color: var(--accent-blue);
}
</style>
