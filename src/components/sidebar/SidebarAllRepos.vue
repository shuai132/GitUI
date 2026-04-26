<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRepoStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { resolveExternalTerminalApp, useSettingsStore } from '@/stores/settings'
import { useGitCommands } from '@/composables/useGitCommands'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import type { RepoMeta } from '@/types/git'

const { t } = useI18n()
const repoStore = useRepoStore()
const uiStore = useUiStore()
const settingsStore = useSettingsStore()
const git = useGitCommands()

async function removeRepo(repoId: string) {
  try {
    await repoStore.closeRepo(repoId)
  } catch (e) {
    console.error(e)
  }
}

// ── 所有仓库列表：可拖动高度 ─────────────────────────────────────────
const REPOS_MIN_HEIGHT = 40

function clampReposHeight(h: number): number {
  const sidebarEl = document.querySelector('.sidebar') as HTMLElement | null
  const sidebarH = sidebarEl?.clientHeight ?? 800
  const max = Math.max(REPOS_MIN_HEIGHT, sidebarH - 160)
  return Math.max(REPOS_MIN_HEIGHT, Math.min(max, h))
}

function startReposResize(e: PointerEvent) {
  e.preventDefault()
  const startY = e.clientY
  const startH = uiStore.reposHeight
  const onMove = (ev: PointerEvent) => {
    const delta = startY - ev.clientY
    uiStore.reposHeight = clampReposHeight(startH + delta)
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    uiStore.persistReposHeight()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}

// ── 所有仓库列表：基于 pointer events 的拖动排序 ────────────────────
interface RepoDragState {
  fromIndex: number
  startY: number
  isDragging: boolean
}
const dragState = ref<RepoDragState | null>(null)
const dragOverIndex = ref<number | null>(null)
const dragInsertBefore = ref(true)
const reposListRef = ref<HTMLElement | null>(null)
let suppressClickUntil = 0
const DRAG_THRESHOLD = 4

const dropIndicatorTop = computed<number | null>(() => {
  const state = dragState.value
  if (!state || !state.isDragging) return null
  if (dragOverIndex.value === null) return null
  const from = state.fromIndex
  const over = dragOverIndex.value
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
  if (!state.isDragging) return
  suppressClickUntil = Date.now() + 300
  if (over === null) return

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

// ── 所有仓库右键菜单 ────────────────────────────────────────────────
const repoMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  target: null as RepoMeta | null,
})

const repoMenuItems = computed<ContextMenuItem[]>(() => [
  { label: t('sidebar.repo.menu.newWindow'), action: 'new-window' },
  { label: t('sidebar.repo.menu.reveal'), action: 'reveal' },
  { label: t('sidebar.repo.menu.openTerminal'), action: 'terminal' },
])

function openRepoMenu(e: MouseEvent, repo: RepoMeta) {
  e.preventDefault()
  e.stopPropagation()
  repoMenu.target = repo
  repoMenu.x = e.clientX
  repoMenu.y = e.clientY
  repoMenu.visible = true
}

function closeRepoMenu() {
  repoMenu.visible = false
}

async function onRepoMenuAction(action: string) {
  const r = repoMenu.target
  if (!r) return
  try {
    switch (action) {
      case 'new-window':
        await git.openInNewWindow(r.id)
        break
      case 'reveal':
        await revealItemInDir(r.path)
        break
      case 'terminal':
        await git.openTerminal(r.id, resolveExternalTerminalApp(settingsStore))
        break
    }
  } catch (err) {
    console.error(err)
  }
}
</script>

<template>
  <div
    class="repos-footer"
    v-if="repoStore.repos.length > 1"
    :style="{ height: uiStore.reposHeight + 'px' }"
  >
    <div class="repos-resize" @pointerdown="startReposResize" />
    <div class="section-title">{{ t('sidebar.repo.allRepos') }}</div>
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
        @contextmenu="openRepoMenu($event, repo)"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>
        <span class="repo-item-name">{{ repo.name }}</span>
        <button
          class="repo-item-remove"
          :title="t('sidebar.repo.removeRepo')"
          @click.stop="removeRepo(repo.id)"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>

    <ContextMenu
      :visible="repoMenu.visible"
      :x="repoMenu.x"
      :y="repoMenu.y"
      :items="repoMenuItems"
      @close="closeRepoMenu"
      @select="onRepoMenuAction"
    />
  </div>
</template>

<style scoped>
@import './sidebar-common.css';

.repos-footer {
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
  position: relative;
  flex-shrink: 0;
  min-height: 40px;
}

.repos-resize {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  cursor: row-resize;
  z-index: 10;
}

.repos-list {
  flex: 1;
  overflow-y: auto;
  position: relative;
  padding-bottom: 8px;
}

.drop-indicator {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent-blue);
  z-index: 20;
  pointer-events: none;
}

.repo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s;
  /* 阻止内部元素的指针事件，让 .repo-item 完全捕获 pointerdown */
}

.repo-item > * {
  pointer-events: none;
}

.repo-item--dragging {
  opacity: 0.5;
}

.repo-item:hover {
  background: var(--bg-overlay);
}

.repo-item--active {
  color: var(--text-primary);
  background: var(--bg-overlay);
  font-weight: 500;
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
