<script setup lang="ts">
import { computed, reactive } from 'vue'
import { RouterLink } from 'vue-router'
import { useRepoStore } from '@/stores/repos'
import { useHistoryStore } from '@/stores/history'
import { useWorkspaceStore } from '@/stores/workspace'
import { buildBranchTree } from '@/utils/branchTree'
import type { BranchInfo } from '@/types/git'
import BranchTreeNode from './BranchTreeNode.vue'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'

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

// Remote branch tree（按 / 分层，第一层是 origin / upstream 等 remote 名）
const remoteTree = computed(() =>
  buildBranchTree(historyStore.branches.filter((b) => b.is_remote))
)

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

async function removeRepo(repoId: string) {
  try {
    await repoStore.closeRepo(repoId)
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

function onSelectRemoteBranch(_branch: BranchInfo) {
  // 远程分支点击暂不切换（需要经过"检出..."弹窗，Step 5 实现）
}

// ── 右键菜单 ─────────────────────────────────────────────────────────
const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  branch: null as BranchInfo | null,
})

const contextMenuItems = computed<ContextMenuItem[]>(() => {
  const b = contextMenu.branch
  if (!b) return []
  const items: ContextMenuItem[] = []

  if (b.is_remote) {
    items.push({ label: '检出...', action: 'checkout-remote' })
  } else if (!b.is_head) {
    items.push({ label: '切换到此分支', action: 'switch' })
  }

  items.push({ label: '复制分支名字', action: 'copy-name' })

  // 只有非当前分支可以删除（当前分支 / 远程分支暂不开放删除）
  if (!b.is_remote && !b.is_head) {
    items.push({ separator: true })
    items.push({ label: '删除...', action: 'delete', danger: true })
  }

  return items
})

function openContextMenu(e: MouseEvent, branch: BranchInfo) {
  e.preventDefault()
  contextMenu.branch = branch
  contextMenu.x = e.clientX
  contextMenu.y = e.clientY
  contextMenu.visible = true
}

function closeContextMenu() {
  contextMenu.visible = false
}

async function onContextAction(action: string) {
  const b = contextMenu.branch
  if (!b) return

  try {
    switch (action) {
      case 'switch':
        await historyStore.switchBranch(b.name)
        break
      case 'checkout-remote':
        // Step 5 实现检出对话框
        console.log('[TODO Step 5] 打开检出远程分支对话框:', b.name)
        break
      case 'copy-name':
        await navigator.clipboard.writeText(b.name)
        break
      case 'delete':
        if (confirm(`确认删除分支 "${b.name}"？此操作无法撤销。`)) {
          await historyStore.deleteBranch(b.name)
        }
        break
    }
  } catch (err) {
    console.error(err)
  }
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
          @contextmenu="openContextMenu($event, b)"
        >
          <span class="branch-dot" :class="b.is_head ? 'dot-solid' : 'dot-outline'" />
          <span class="branch-label">{{ b.name }}</span>
          <span
            v-if="(b.ahead ?? 0) > 0 || (b.behind ?? 0) > 0"
            class="ahead-behind"
          >
            <span v-if="(b.ahead ?? 0) > 0" class="ab-ahead">↑{{ b.ahead }}</span>
            <span v-if="(b.behind ?? 0) > 0" class="ab-behind">↓{{ b.behind }}</span>
          </span>
        </div>
      </div>

      <!-- REMOTE tree section -->
      <div class="section" v-if="remoteTree.length > 0 && repoStore.activeRepoId">
        <div class="section-title">REMOTE</div>
        <BranchTreeNode
          v-for="root in remoteTree"
          :key="root.path"
          :node="root"
          :level="0"
          @select-branch="onSelectRemoteBranch"
          @branch-context-menu="openContextMenu"
        />
      </div>
    </div>

    <!-- Bottom: additional repos -->
    <div class="repos-footer" v-if="repoStore.repos.length > 1">
      <div class="section-title">其他仓库</div>
      <div
        v-for="repo in repoStore.repos"
        :key="repo.id"
        class="repo-item"
        :class="{ 'repo-item--active': repo.id === repoStore.activeRepoId }"
        :title="repo.path"
        @click="repoStore.setActive(repo.id)"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>
        <span class="repo-item-name">{{ repo.name }}</span>
        <button
          class="repo-item-remove"
          title="移除仓库"
          @click.stop="removeRepo(repo.id)"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Branch context menu -->
    <ContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenuItems"
      @close="closeContextMenu"
      @select="onContextAction"
    />
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
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ahead-behind {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  background: var(--bg-overlay);
  padding: 1px 5px;
  border-radius: 7px;
  line-height: 1.4;
}

.ab-ahead {
  color: var(--accent-green);
}

.ab-behind {
  color: var(--accent-orange);
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
  padding: 4px 8px 4px 12px;
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

.repo-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-item-remove {
  display: none;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  padding: 2px;
  border-radius: 3px;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.1s, color 0.1s;
}

.repo-item:hover .repo-item-remove {
  display: inline-flex;
}

.repo-item-remove:hover {
  background: rgba(237, 135, 150, 0.18);
  color: var(--accent-red);
}
</style>
