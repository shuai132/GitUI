<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useRepoStore } from '@/stores/repos'
import { useHistoryStore } from '@/stores/history'
import { useStashStore } from '@/stores/stash'
import { useUiStore } from '@/stores/ui'
import { useGitCommands } from '@/composables/useGitCommands'
import ReflogDialog from '@/components/common/ReflogDialog.vue'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'

const repoStore = useRepoStore()
const historyStore = useHistoryStore()
const stashStore = useStashStore()
const uiStore = useUiStore()
const git = useGitCommands()
const appWindow = getCurrentWindow()

// ── 每个按钮的 loading 状态 ────────────────────────────────────────
const busy = reactive({
  pull: false,
  push: false,
  stash: false,
  pop: false,
  fetch: false,
  gc: false,
})

const showReflogDialog = ref(false)
const searchInputEl = ref<HTMLInputElement | null>(null)

// ── 仓库已打开时按钮才可用 ────────────────────────────────────────
const hasRepo = computed(() => !!repoStore.activeRepoId)

const currentBranch = computed(
  () =>
    historyStore.branches.find((b) => b.is_head && !b.is_remote)?.name ?? null,
)

const canRemoteOp = computed(() => hasRepo.value && currentBranch.value !== null)
const canStashPop = computed(() => hasRepo.value && stashStore.entries.length > 0)

// ── 工具栏全局错误展示（浮层） ─────────────────────────────────────
const toastError = ref<string | null>(null)
let toastTimer: number | null = null
function showError(msg: string) {
  toastError.value = msg
  if (toastTimer !== null) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastError.value = null
    toastTimer = null
  }, 4000)
}

// ── Helpers ────────────────────────────────────────────────────────
async function pickRemote(): Promise<string | null> {
  const id = repoStore.activeRepoId
  if (!id) return null
  try {
    const remotes = await git.listRemotes(id)
    if (remotes.length === 0) return null
    return remotes.includes('origin') ? 'origin' : remotes[0]
  } catch {
    return null
  }
}

// ── 打开仓库 ────────────────────────────────────────────────────────
async function openFolder() {
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

// ── Pull ────────────────────────────────────────────────────────────
async function onPull() {
  const id = repoStore.activeRepoId
  const branch = currentBranch.value
  if (!id || !branch) return
  const remote = await pickRemote()
  if (!remote) {
    showError('当前仓库没有配置 remote')
    return
  }
  busy.pull = true
  try {
    await git.pullBranch(id, remote, branch)
    await Promise.all([historyStore.loadLog(), historyStore.loadBranches()])
  } catch (e) {
    showError(`Pull 失败：${String(e)}`)
  } finally {
    busy.pull = false
  }
}

// ── Push ────────────────────────────────────────────────────────────
async function onPush() {
  const id = repoStore.activeRepoId
  const branch = currentBranch.value
  if (!id || !branch) return
  const remote = await pickRemote()
  if (!remote) {
    showError('当前仓库没有配置 remote')
    return
  }
  busy.push = true
  try {
    await git.pushBranch(id, remote, branch)
    await historyStore.loadBranches()
  } catch (e) {
    showError(`Push 失败：${String(e)}`)
  } finally {
    busy.push = false
  }
}

// ── Stash / Pop ─────────────────────────────────────────────────────
async function onStash() {
  if (!hasRepo.value) return
  busy.stash = true
  try {
    await stashStore.push()
  } catch (e) {
    showError(`Stash 失败：${String(e)}`)
  } finally {
    busy.stash = false
  }
}

async function onPop() {
  if (!canStashPop.value) return
  busy.pop = true
  try {
    await stashStore.pop()
  } catch (e) {
    showError(`Stash pop 失败：${String(e)}`)
  } finally {
    busy.pop = false
  }
}

// ── Terminal ────────────────────────────────────────────────────────
async function onTerminal() {
  const id = repoStore.activeRepoId
  if (!id) return
  try {
    await git.openTerminal(id)
  } catch (e) {
    showError(`打开终端失败：${String(e)}`)
  }
}

// ── Actions 下拉菜单 ───────────────────────────────────────────────
const actionsMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
})
const actionsBtnRef = ref<HTMLButtonElement | null>(null)

const actionsMenuItems = computed<ContextMenuItem[]>(() => [
  {
    label: busy.fetch ? '抓取中...' : '抓取 (Fetch)',
    action: 'fetch',
    disabled: !hasRepo.value || busy.fetch,
  },
  { separator: true },
  {
    label: '显示 Reflog...',
    action: 'reflog',
    disabled: !hasRepo.value,
  },
  {
    label: busy.gc ? '清理中...' : '清理仓库 (git gc)',
    action: 'gc',
    disabled: !hasRepo.value || busy.gc,
  },
  { separator: true },
  {
    label: '丢弃所有变更...',
    action: 'discard-all',
    danger: true,
    disabled: !hasRepo.value,
  },
])

function onActions() {
  const el = actionsBtnRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  actionsMenu.x = rect.right - 200
  actionsMenu.y = rect.bottom + 4
  actionsMenu.visible = true
}

async function onActionsSelect(action: string) {
  actionsMenu.visible = false
  const id = repoStore.activeRepoId
  if (!id) return
  switch (action) {
    case 'fetch': {
      const remote = await pickRemote()
      if (!remote) {
        showError('当前仓库没有配置 remote')
        return
      }
      busy.fetch = true
      try {
        await git.fetchRemote(id, remote)
        await historyStore.loadBranches()
      } catch (e) {
        showError(`Fetch 失败：${String(e)}`)
      } finally {
        busy.fetch = false
      }
      break
    }
    case 'reflog': {
      showReflogDialog.value = true
      break
    }
    case 'gc': {
      busy.gc = true
      try {
        const msg = await git.runGc(id)
        showError(msg)  // 借用 toast 展示成功信息
      } catch (e) {
        showError(`git gc 失败：${String(e)}`)
      } finally {
        busy.gc = false
      }
      break
    }
    case 'discard-all': {
      // 转发到 HistoryView 的 WipPanel 处理：通过 uiStore 触发
      uiStore.requestDiscardAll()
      break
    }
  }
}

// ── 顶部工具栏作为窗口拖动区域 ─────────────────────────────────────
function handleDragStart(e: MouseEvent) {
  if (e.button !== 0) return
  if ((e.target as HTMLElement).closest('button, input, a, select, textarea')) return
  appWindow.startDragging()
}

async function handleDblClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, input, a, select, textarea')) return
  if (await appWindow.isMaximized()) await appWindow.unmaximize()
  else await appWindow.maximize()
}
</script>

<template>
  <div
    class="toolbar"
    data-tauri-drag-region
    @mousedown="handleDragStart"
    @dblclick="handleDblClick"
  >

    <div class="toolbar-actions">
      <button class="btn-tool" title="打开仓库" @click="openFolder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span>打开</span>
      </button>

      <div class="toolbar-sep" />

      <!-- Pull (with chevron placeholder) -->
      <button
        class="btn-tool btn-tool--pull"
        title="Pull (fetch + merge)"
        :disabled="!canRemoteOp || busy.pull"
        @click="onPull"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14"/>
          <polyline points="19 12 12 19 5 12"/>
        </svg>
        <span>{{ busy.pull ? 'Pulling...' : 'Pull' }}</span>
        <svg class="chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      <!-- Push -->
      <button
        class="btn-tool"
        title="Push 当前分支"
        :disabled="!canRemoteOp || busy.push"
        @click="onPush"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 19V5"/>
          <polyline points="5 12 12 5 19 12"/>
        </svg>
        <span>{{ busy.push ? 'Pushing...' : 'Push' }}</span>
      </button>

      <!-- Stash -->
      <button
        class="btn-tool"
        title="Stash 当前工作区"
        :disabled="!hasRepo || busy.stash"
        @click="onStash"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
        </svg>
        <span>Stash</span>
      </button>

      <!-- Pop -->
      <button
        class="btn-tool"
        :title="canStashPop ? `Pop 最新 stash (共 ${stashStore.entries.length} 条)` : '没有 stash'"
        :disabled="!canStashPop || busy.pop"
        @click="onPop"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="5 12 12 5 19 12"/>
          <line x1="12" y1="5" x2="12" y2="19"/>
        </svg>
        <span>Pop</span>
      </button>

      <!-- Terminal -->
      <button
        class="btn-tool"
        title="在系统终端打开仓库"
        :disabled="!hasRepo"
        @click="onTerminal"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
        <span>Terminal</span>
      </button>
    </div>

    <div class="toolbar-spacer" data-tauri-drag-region />

    <!-- 错误提示（自动消失） -->
    <div v-if="toastError" class="toast-error" :title="toastError">
      {{ toastError }}
    </div>

    <!-- 右侧：更多、搜索框、布局切换 -->
    <div class="toolbar-right">
      <button
        ref="actionsBtnRef"
        class="btn-icon-only"
        title="更多操作"
        :disabled="!hasRepo"
        @click="onActions"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="1"/>
          <circle cx="19" cy="12" r="1"/>
          <circle cx="5" cy="12" r="1"/>
        </svg>
      </button>

      <div v-if="hasRepo" class="search-box">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref="searchInputEl"
          v-model="uiStore.historySearchQuery"
          class="search-input"
          placeholder="搜索提交..."
        />
      </div>

      <button
        v-if="hasRepo"
        class="btn-icon-only"
        :title="uiStore.historyLayoutMode === 'horizontal' ? '切换为上下布局' : '切换为左右布局'"
        @click="uiStore.toggleHistoryLayout()"
      >
        <svg v-if="uiStore.historyLayoutMode === 'horizontal'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="12" rx="1"/>
          <line x1="8" y1="2" x2="8" y2="14"/>
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="12" rx="1"/>
          <line x1="2" y1="8" x2="14" y2="8"/>
        </svg>
      </button>
    </div>

    <ReflogDialog
      :visible="showReflogDialog"
      @close="showReflogDialog = false"
    />

    <ContextMenu
      :visible="actionsMenu.visible"
      :x="actionsMenu.x"
      :y="actionsMenu.y"
      :items="actionsMenuItems"
      @close="actionsMenu.visible = false"
      @select="onActionsSelect"
    />
  </div>
</template>

<style scoped>
.toolbar {
  height: 38px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  gap: 8px;
  flex-shrink: 0;
  /* macOS traffic lights 让出 78px 空间 */
  padding-left: 78px;
  position: relative;
}

.toolbar-sep {
  width: 1px;
  height: 22px;
  background: var(--border);
  flex-shrink: 0;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-spacer {
  flex: 1;
  align-self: stretch;
  min-width: 0;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 5px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 8px;
  color: var(--text-muted);
}

.search-input {
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 11px;
  font-family: inherit;
  outline: none;
  width: 150px;
}

.search-input::placeholder {
  color: var(--text-muted);
}

.btn-tool {
  background: none;
  border: 1px solid var(--border);
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px 8px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-family: inherit;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.btn-tool:hover:not(:disabled) {
  background: var(--bg-overlay);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.btn-tool:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-tool--pull .chevron {
  opacity: 0.6;
  margin-left: 1px;
}

.btn-icon-only {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 5px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: background 0.15s, color 0.15s;
}

.btn-icon-only:hover:not(:disabled) {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.btn-icon-only:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toast-error {
  position: absolute;
  top: 44px;
  right: 12px;
  max-width: 440px;
  background: var(--bg-surface);
  border: 1px solid var(--accent-red);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--accent-red);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  z-index: 50;
}
</style>
