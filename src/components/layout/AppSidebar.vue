<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useRepoStore } from '@/stores/repos'
import { useHistoryStore } from '@/stores/history'
import { useWorkspaceStore } from '@/stores/workspace'
import { buildBranchTree } from '@/utils/branchTree'
import type { BranchInfo } from '@/types/git'
import BranchTreeNode from './BranchTreeNode.vue'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import CheckoutRemoteDialog from '@/components/branch/CheckoutRemoteDialog.vue'

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

// ── 其他仓库列表：可拖动高度 + 持久化 ────────────────────────────────
// 默认大约 6 条的高度（section-title ~22 + 6 行 × 22 + padding ~6 ≈ 160）
const REPOS_HEIGHT_KEY = 'gitui.sidebar.reposHeight'
const REPOS_MIN_HEIGHT = 40
const REPOS_DEFAULT_HEIGHT = 160
const reposHeight = ref<number>(
  Number(localStorage.getItem(REPOS_HEIGHT_KEY)) || REPOS_DEFAULT_HEIGHT,
)

function clampReposHeight(h: number): number {
  // 上限：不能把 sidebar 上方挤到只剩 160px
  const sidebarEl = document.querySelector('.sidebar') as HTMLElement | null
  const sidebarH = sidebarEl?.clientHeight ?? 800
  const max = Math.max(REPOS_MIN_HEIGHT, sidebarH - 160)
  return Math.max(REPOS_MIN_HEIGHT, Math.min(max, h))
}

function startReposResize(e: PointerEvent) {
  e.preventDefault()
  const startY = e.clientY
  const startH = reposHeight.value
  const onMove = (ev: PointerEvent) => {
    // 往上拖（y 减小）→ footer 变高
    const delta = startY - ev.clientY
    reposHeight.value = clampReposHeight(startH + delta)
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem(REPOS_HEIGHT_KEY, String(reposHeight.value))
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}

// ── 其他仓库列表：基于 pointer events 的拖动排序 ────────────────────
// 不用 HTML5 DnD 是因为 Tauri WKWebView 下 drag image / dropEffect / hit
// testing 都不稳；自实现更可控，也能完全去掉浏览器的 drag cursor。
interface RepoDragState {
  fromIndex: number
  startY: number
  isDragging: boolean
}
const dragState = ref<RepoDragState | null>(null)
const dragOverIndex = ref<number | null>(null)
const dragInsertBefore = ref(true) // 插入到 overIndex 之前还是之后
const reposListRef = ref<HTMLElement | null>(null)
// 拖动结束后短时间抑制 click，避免触发 setActive
let suppressClickUntil = 0
const DRAG_THRESHOLD = 4

// drop indicator 的 top 偏移（相对 .repos-list），null 表示不显示
const dropIndicatorTop = computed<number | null>(() => {
  const state = dragState.value
  if (!state || !state.isDragging) return null
  if (dragOverIndex.value === null) return null
  const from = state.fromIndex
  const over = dragOverIndex.value
  // 等价于不动的几种位置：拖到自己、拖到前一项下半、拖到后一项上半
  if (over === from) return null
  if (over === from - 1 && !dragInsertBefore.value) return null
  if (over === from + 1 && dragInsertBefore.value) return null

  const listEl = reposListRef.value
  if (!listEl) return null
  const items = listEl.querySelectorAll<HTMLElement>('.repo-item')
  const item = items[over]
  if (!item) return null
  return dragInsertBefore.value ? item.offsetTop : item.offsetTop + item.offsetHeight
})

function updateDragOverFromPointer(clientY: number) {
  const listEl = reposListRef.value
  if (!listEl) return
  const items = listEl.querySelectorAll<HTMLElement>('.repo-item')
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect()
    if (clientY < rect.top) {
      dragOverIndex.value = i
      dragInsertBefore.value = true
      return
    }
    if (clientY <= rect.bottom) {
      dragOverIndex.value = i
      dragInsertBefore.value = clientY < rect.top + rect.height / 2
      return
    }
  }
  if (items.length > 0) {
    dragOverIndex.value = items.length - 1
    dragInsertBefore.value = false
  }
}

function onRepoPointerDown(e: PointerEvent, index: number) {
  if (e.button !== 0) return
  dragState.value = {
    fromIndex: index,
    startY: e.clientY,
    isDragging: false,
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  const state = dragState.value
  if (!state) return
  if (!state.isDragging) {
    if (Math.abs(e.clientY - state.startY) < DRAG_THRESHOLD) return
    state.isDragging = true
  }
  updateDragOverFromPointer(e.clientY)
}

async function onPointerUp(_e: PointerEvent) {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  const state = dragState.value
  dragState.value = null
  if (!state) return
  const over = dragOverIndex.value
  const before = dragInsertBefore.value
  dragOverIndex.value = null
  if (!state.isDragging) return // 未达阈值，视为普通 click
  suppressClickUntil = Date.now() + 300
  if (over === null) return

  // 用户视角的目标位置（删除源前的坐标系）
  const from = state.fromIndex
  let target = before ? over : over + 1
  if (from < target) target -= 1
  if (target < 0) target = 0
  if (target >= repoStore.repos.length) target = repoStore.repos.length - 1
  if (target === from) return
  await repoStore.reorderRepos(from, target)
}

function onRepoClick(e: MouseEvent, repoId: string) {
  if (Date.now() < suppressClickUntil) {
    e.preventDefault()
    e.stopPropagation()
    return
  }
  repoStore.setActive(repoId)
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

// ── 右键菜单 / 检出对话框 ────────────────────────────────────────────
const remoteBranchesFlat = computed(() =>
  historyStore.branches.filter((b) => b.is_remote),
)

const showCheckoutDialog = ref(false)
const checkoutInitialRemote = ref<string | null>(null)

function openCheckoutDialog(remoteBranchName: string) {
  checkoutInitialRemote.value = remoteBranchName
  showCheckoutDialog.value = true
}

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
        openCheckoutDialog(b.name)
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

    <!-- Bottom: additional repos (可拖动高度 + 拖动排序) -->
    <div
      class="repos-footer"
      v-if="repoStore.repos.length > 1"
      :style="{ height: reposHeight + 'px' }"
    >
      <div class="repos-resize" @pointerdown="startReposResize" />
      <div class="section-title">其他仓库</div>
      <div class="repos-list" ref="reposListRef">
        <div
          v-if="dropIndicatorTop !== null"
          class="drop-indicator"
          :style="{ top: dropIndicatorTop + 'px' }"
        />
        <div
          v-for="(repo, idx) in repoStore.repos"
          :key="repo.id"
          class="repo-item"
          :class="{
            'repo-item--active': repo.id === repoStore.activeRepoId,
            'repo-item--dragging': dragState?.isDragging && dragState?.fromIndex === idx,
          }"
          :title="repo.path"
          @pointerdown="onRepoPointerDown($event, idx)"
          @click="onRepoClick($event, repo.id)"
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

    <!-- Checkout remote branch dialog -->
    <CheckoutRemoteDialog
      :visible="showCheckoutDialog"
      :remote-branches="remoteBranchesFlat"
      :initial-remote="checkoutInitialRemote"
      @close="showCheckoutDialog = false"
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
  position: relative;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 40px;
}

/* 顶部拖动条，骑在 border-top 上 */
.repos-resize {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  cursor: row-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;
}
.repos-resize:hover,
.repos-resize:active {
  background: rgba(138, 173, 244, 0.3);
}

.repos-list {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
}

/* 拖动时的插入位置高亮横线 */
.drop-indicator {
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  background: var(--accent-blue);
  border-radius: 1px;
  pointer-events: none;
  z-index: 5;
  transform: translateY(-1px);
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
  /* 阻止浏览器 HTML5 拖动默认行为（会生成 drag image + 加号光标） */
  -webkit-user-drag: none;
}

/* 子元素不接收 pointer，让 drag 事件冒泡到 .repo-item；
   删除按钮单独解除（下面的 .repo-item > .repo-item-remove） */
.repo-item > * {
  pointer-events: none;
}

/* 特异性 0-2-0 > 上面的 0-1-1，覆盖回可响应 */
.repo-item > .repo-item-remove {
  pointer-events: auto;
}

.repo-item:hover {
  background: var(--bg-overlay);
}

.repo-item--active {
  color: var(--accent-blue);
}

/* 拖动源半透明反馈 */
.repo-item--dragging {
  opacity: 0.4;
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
  /* 覆盖 .repo-item > * 的 pointer-events: none 让按钮仍可点击 */
  pointer-events: auto;
}

.repo-item:hover .repo-item-remove {
  display: inline-flex;
}

.repo-item-remove:hover {
  background: rgba(237, 135, 150, 0.18);
  color: var(--accent-red);
}
</style>
