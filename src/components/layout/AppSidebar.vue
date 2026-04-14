<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useRepoStore } from '@/stores/repos'
import { useHistoryStore } from '@/stores/history'
import { useSubmodulesStore } from '@/stores/submodules'
import { useStashStore } from '@/stores/stash'
import { useUiStore } from '@/stores/ui'
import { resolveExternalTerminalApp, useSettingsStore } from '@/stores/settings'
import { buildBranchTree } from '@/utils/branchTree'
import type { BranchInfo, SubmoduleInfo, StashEntry, TagInfo } from '@/types/git'
import BranchTreeNode from './BranchTreeNode.vue'
import { useSidebarSectionState } from '@/composables/useSidebarSectionState'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import CheckoutRemoteDialog from '@/components/branch/CheckoutRemoteDialog.vue'
import EditSubmoduleDialog from '@/components/submodule/EditSubmoduleDialog.vue'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoCreation } from '@/composables/useRepoCreation'
import { usePickRemote } from '@/composables/usePickRemote'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import type { RepoMeta } from '@/types/git'

const git = useGitCommands()
const repoCreation = useRepoCreation()
const { pickRemote } = usePickRemote()
const { t } = useI18n()

const router = useRouter()
const repoStore = useRepoStore()
const historyStore = useHistoryStore()
const submodulesStore = useSubmodulesStore()
const stashStore = useStashStore()
const uiStore = useUiStore()
const settingsStore = useSettingsStore()
const sectionState = useSidebarSectionState()

// Local branches
const localBranches = computed(() =>
  historyStore.branches.filter((b) => !b.is_remote)
)

// Remote branch tree（按 / 分层，第一层是 origin / upstream 等 remote 名）
const remoteTree = computed(() =>
  buildBranchTree(historyStore.branches.filter((b) => b.is_remote))
)

// 侧栏空间紧张，+ 按钮直接弹「添加仓库」菜单（打开 / 克隆 / 新建），
// 不再保留默认动作；菜单中的「打开」对应原行为。
function showAddRepoMenu(e: MouseEvent) {
  repoCreation.showMenuAt(e.currentTarget as HTMLElement)
}

async function removeRepo(repoId: string) {
  try {
    await repoStore.closeRepo(repoId)
  } catch (e) {
    console.error(e)
  }
}

// ── 所有仓库列表：可拖动高度 ─────────────────────────────────────────
// 持久化由 uiStore 管理，组件只负责 clamp + 拖动期间的响应式更新
const REPOS_MIN_HEIGHT = 40

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
  const startH = uiStore.reposHeight
  const onMove = (ev: PointerEvent) => {
    // 往上拖（y 减小）→ footer 变高
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

// 单击任意分支/stash：跳历史并选中对应 commit
function jumpToBranchCommit(commitOid: string) {
  historyStore.pendingJumpOid = commitOid
  router.push('/history')
}

// 双击本地分支：切换
async function switchBranch(name: string) {
  try {
    await historyStore.switchBranch(name)
  } catch (e) {
    console.error(e)
  }
}

// 单击 remote 分支：跳历史
function onSelectRemoteBranch(branch: BranchInfo) {
  if (branch.commit_oid) jumpToBranchCommit(branch.commit_oid)
}

// 双击 remote 分支：弹出 checkout 对话框
function onDblclickRemoteBranch(branch: BranchInfo) {
  openCheckoutDialog(branch.name)
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
    items.push({ label: t('sidebar.branch.menu.checkoutRemote'), action: 'checkout-remote' })
  } else if (!b.is_head) {
    items.push({ label: t('sidebar.branch.menu.switchTo'), action: 'switch' })
  }

  items.push({ label: t('sidebar.branch.menu.copyName'), action: 'copy-name' })

  // 只有非当前分支可以删除（当前分支 / 远程分支暂不开放删除）
  if (!b.is_remote && !b.is_head) {
    items.push({ separator: true })
    items.push({ label: t('sidebar.branch.menu.delete'), action: 'delete', danger: true })
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
        if (confirm(t('sidebar.branch.confirmDelete', { name: b.name }))) {
          await historyStore.deleteBranch(b.name)
        }
        break
    }
  } catch (err) {
    console.error(err)
  }
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

// ── Submodules ───────────────────────────────────────────────────────
const submodules = computed(() => submodulesStore.submodules)

const submoduleMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  target: null as SubmoduleInfo | null,
})

const editDialog = reactive({
  visible: false,
  target: null as SubmoduleInfo | null,
})

const submoduleMenuItems = computed<ContextMenuItem[]>(() => {
  const s = submoduleMenu.target
  if (!s) return []
  const isInitialized = s.state !== 'uninitialized'
  return [
    {
      label: t('sidebar.submodule.menu.init', { path: s.path }),
      action: 'init',
      disabled: isInitialized,
    },
    { label: t('sidebar.submodule.menu.update', { path: s.path }), action: 'update' },
    { separator: true },
    { label: t('sidebar.submodule.menu.edit', { path: s.path }), action: 'edit' },
    { separator: true },
    { label: t('sidebar.submodule.menu.delete'), action: 'delete', danger: true },
  ]
})

function openSubmoduleMenu(e: MouseEvent, s: SubmoduleInfo) {
  e.preventDefault()
  e.stopPropagation()
  submoduleMenu.target = s
  // 把菜单定位到按钮右下方而非鼠标位置，视觉更稳定
  const btn = e.currentTarget as HTMLElement | null
  if (btn) {
    const rect = btn.getBoundingClientRect()
    submoduleMenu.x = rect.right
    submoduleMenu.y = rect.bottom
  } else {
    submoduleMenu.x = e.clientX
    submoduleMenu.y = e.clientY
  }
  submoduleMenu.visible = true
}

function closeSubmoduleMenu() {
  submoduleMenu.visible = false
}

async function onSubmoduleMenuAction(action: string) {
  const s = submoduleMenu.target
  if (!s) return
  try {
    switch (action) {
      case 'init':
        await submodulesStore.init(s.name)
        break
      case 'update':
        await submodulesStore.update(s.name)
        break
      case 'edit':
        editDialog.target = s
        editDialog.visible = true
        break
      case 'delete':
        if (
          confirm(
            t('sidebar.submodule.confirmDelete', { path: s.path, name: s.name }),
          )
        ) {
          await submodulesStore.deinit(s.name)
        }
        break
    }
  } catch (err) {
    console.error(err)
    alert(t('common.operationFailed', { detail: String(err) }))
  }
}

async function onSubmoduleClick(s: SubmoduleInfo) {
  // 未初始化 / 未 clone 的 submodule 不能作为仓库打开
  if (s.state === 'uninitialized' || s.state === 'not_cloned' || s.state === 'not_found') {
    return
  }
  try {
    const absPath = await submodulesStore.workdir(s.name)
    await repoStore.openRepo(absPath)
  } catch (err) {
    console.error(err)
    alert(t('sidebar.submodule.openFailed', { detail: String(err) }))
  }
}

// ── Tags ─────────────────────────────────────────────────────────────
const tags = computed(() => historyStore.tags)

type TagRemoteStatus = 'synced' | 'local_only' | 'unknown'
function tagRemoteStatus(tag: TagInfo): TagRemoteStatus {
  if (!historyStore.remoteTagsChecked) return 'unknown'
  return historyStore.remoteTagNames.has(tag.name) ? 'synced' : 'local_only'
}
function tagStatusLabel(status: TagRemoteStatus): string {
  switch (status) {
    case 'synced':
      return t('history.tag.status.synced')
    case 'local_only':
      return t('history.tag.status.localOnly')
    default:
      return t('history.tag.status.unknown')
  }
}
function tagItemTitle(tag: TagInfo): string {
  const base = tag.is_annotated && tag.message
    ? `${tag.name}\n\n${tag.message}`
    : tag.name
  return `${base}\n[${tagStatusLabel(tagRemoteStatus(tag))}]`
}

const tagMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  target: null as TagInfo | null,
})

const tagMenuItems = computed<ContextMenuItem[]>(() => {
  const tag = tagMenu.target
  if (!tag) return []
  return [
    { label: t('sidebar.tag.menu.copyName'), action: 'copy-name' },
    { label: t('sidebar.tag.menu.copyOid'), action: 'copy-oid' },
    { separator: true },
    { label: t('sidebar.tag.menu.push'), action: 'push' },
    { separator: true },
    { label: t('sidebar.tag.menu.delete'), action: 'delete', danger: true },
  ]
})

function openTagMenu(e: MouseEvent, tag: TagInfo) {
  e.preventDefault()
  tagMenu.target = tag
  tagMenu.x = e.clientX
  tagMenu.y = e.clientY
  tagMenu.visible = true
}

function closeTagMenu() {
  tagMenu.visible = false
}

async function onTagMenuAction(action: string) {
  const tag = tagMenu.target
  if (!tag) return
  try {
    switch (action) {
      case 'copy-name':
        await navigator.clipboard.writeText(tag.name)
        break
      case 'copy-oid':
        await navigator.clipboard.writeText(tag.commit_oid)
        break
      case 'push': {
        const id = repoStore.activeRepoId
        if (!id) break
        // 多 remote 时弹菜单让用户选；无 remote / 用户取消则 no-op。
        // 失败由 useGitCommands.call() 统一推到 errorsStore + 顶栏 toast。
        const remote = await pickRemote(id)
        if (!remote) break
        await git.pushTag(id, remote, tag.name)
        // 乐观更新：push 成功后该 tag 一定在该远端存在
        historyStore.markTagPushed(tag.name)
        break
      }
      case 'delete':
        if (confirm(t('sidebar.tag.confirmDelete', { name: tag.name }))) {
          await historyStore.deleteTag(tag.name)
        }
        break
    }
  } catch (err) {
    console.error(err)
    alert(t('common.operationFailed', { detail: String(err) }))
  }
}

// ── Stash ────────────────────────────────────────────────────────────
function onStashClick(commitOid: string) {
  jumpToBranchCommit(commitOid)
}

const stashMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  target: null as StashEntry | null,
})

const stashMenuItems = computed<ContextMenuItem[]>(() => {
  const s = stashMenu.target
  if (!s) return []
  return [
    { label: t('sidebar.stash.menu.apply'), action: 'apply' },
    { label: t('sidebar.stash.menu.pop'), action: 'pop' },
    { label: t('sidebar.stash.menu.delete'), action: 'delete' },
  ]
})

function openStashMenu(e: MouseEvent, s: StashEntry) {
  e.preventDefault()
  e.stopPropagation()
  stashMenu.target = s
  stashMenu.x = e.clientX
  stashMenu.y = e.clientY
  stashMenu.visible = true
}

function closeStashMenu() {
  stashMenu.visible = false
}

async function onStashMenuAction(action: string) {
  const s = stashMenu.target
  if (!s) return
  try {
    switch (action) {
      case 'apply':
        await stashStore.apply(s.index)
        break
      case 'pop':
        await stashStore.pop(s.index)
        break
      case 'delete':
        if (confirm(t('sidebar.stash.confirmDelete', { index: s.index, message: s.message }))) {
          await stashStore.drop(s.index)
        }
        break
    }
  } catch (err) {
    console.error(err)
    alert(t('common.operationFailed', { detail: String(err) }))
  }
}
</script>

<template>
  <aside class="sidebar">
    <!-- Repo header -->
    <div class="repo-header">
      <div class="repo-name" :title="repoStore.activeRepo()?.path">
        {{ repoStore.activeRepo()?.name ?? t('sidebar.repo.noRepo') }}
      </div>
      <button
        class="btn-add"
        :title="t('repo.menu.title')"
        data-menu-anchor
        @click="showAddRepoMenu($event)"
      >+</button>
    </div>

    <div class="sidebar-scroll">
      <!-- LOCAL BRANCHES section -->
      <div class="section" v-if="localBranches.length > 0 && repoStore.activeRepoId">
        <div class="section-title collapsible" @click="sectionState.toggle('local-branches')">
          <svg class="chevron" :class="{ open: !sectionState.isCollapsed('local-branches') }"
               width="10" height="10" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span class="section-label">LOCAL BRANCHES</span>
          <span class="section-count">{{ localBranches.length }}</span>
        </div>
        <template v-if="!sectionState.isCollapsed('local-branches')">
          <div
            v-for="b in localBranches"
            :key="b.name"
            class="branch-item"
            :class="{ 'branch-item--current': b.is_head }"
            @click="b.commit_oid && jumpToBranchCommit(b.commit_oid)"
            @dblclick.stop="!b.is_head && switchBranch(b.name)"
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
        </template>
      </div>

      <!-- TAGS section -->
      <div class="section" v-if="tags.length > 0 && repoStore.activeRepoId">
        <div class="section-title collapsible" @click="sectionState.toggle('tags')">
          <svg class="chevron" :class="{ open: !sectionState.isCollapsed('tags') }"
               width="10" height="10" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span class="section-label">TAGS</span>
          <span class="section-count">{{ tags.length }}</span>
        </div>
        <template v-if="!sectionState.isCollapsed('tags')">
          <div
            v-for="tag in tags"
            :key="tag.name"
            class="branch-item tag-item"
            :class="{ 'tag-item--lightweight': !tag.is_annotated }"
            :title="tagItemTitle(tag)"
            @click="jumpToBranchCommit(tag.commit_oid)"
            @contextmenu="openTagMenu($event, tag)"
          >
            <svg
              class="tag-icon"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
            <span class="branch-label">{{ tag.name }}</span>
            <span
              v-if="tagRemoteStatus(tag) === 'synced'"
              class="tag-status-icon tag-status-icon--synced"
              aria-hidden="true"
            >✓</span>
            <span
              v-else-if="tagRemoteStatus(tag) === 'local_only'"
              class="tag-status-icon tag-status-icon--local"
              aria-hidden="true"
            >↑</span>
          </div>
        </template>
      </div>

      <!-- STASH section -->
      <div
        class="section"
        v-if="stashStore.entries.length > 0 && repoStore.activeRepoId"
      >
        <div class="section-title collapsible" @click="sectionState.toggle('stash')">
          <svg class="chevron" :class="{ open: !sectionState.isCollapsed('stash') }"
               width="10" height="10" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span class="section-label">STASH</span>
          <span class="section-count">{{ stashStore.entries.length }}</span>
        </div>
        <template v-if="!sectionState.isCollapsed('stash')">
          <div
            v-for="s in stashStore.entries"
            :key="s.index"
            class="branch-item stash-item"
            :title="s.message"
            @click="onStashClick(s.commit_oid)"
            @contextmenu="openStashMenu($event, s)"
          >
            <span class="branch-dot dot-outline" />
            <span class="stash-index">{{ '{' + s.index + '}' }}</span>
            <span class="branch-label">{{ s.message }}</span>
          </div>
        </template>
      </div>

      <!-- SUBMODULES section -->
      <div class="section" v-if="submodules.length > 0 && repoStore.activeRepoId">
        <div class="section-title collapsible" @click="sectionState.toggle('submodules')">
          <svg class="chevron" :class="{ open: !sectionState.isCollapsed('submodules') }"
               width="10" height="10" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span class="section-label">SUBMODULES</span>
          <span class="section-count">{{ submodules.length }}</span>
        </div>
        <template v-if="!sectionState.isCollapsed('submodules')">
        <div
          v-for="s in submodules"
          :key="s.name"
          class="submodule-item"
          :class="{
            'submodule-item--dim':
              s.state === 'uninitialized' || s.state === 'not_cloned' || s.state === 'not_found',
          }"
          :title="`${s.path}${s.url ? '\n' + s.url : ''}`"
          @click="onSubmoduleClick(s)"
        >
          <!-- 警告三角：未 init / 未 clone / 找不到 -->
          <svg
            v-if="s.state === 'uninitialized' || s.state === 'not_cloned' || s.state === 'not_found'"
            class="sub-warn"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <!-- submodule 小图标（立方体） -->
          <svg
            v-else
            class="sub-icon"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          <span class="submodule-label">{{ s.path }}</span>
          <span v-if="s.has_workdir_modifications" class="sub-dot" :title="t('sidebar.submodule.hasChanges')" />
          <button
            class="submodule-kebab"
            :title="t('sidebar.submodule.menuTitle')"
            @click="openSubmoduleMenu($event, s)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.7"/>
              <circle cx="12" cy="12" r="1.7"/>
              <circle cx="12" cy="19" r="1.7"/>
            </svg>
          </button>
        </div>
        </template>
      </div>

      <!-- REMOTE tree section -->
      <div class="section" v-if="remoteTree.length > 0 && repoStore.activeRepoId">
        <div class="section-title collapsible" @click="sectionState.toggle('remote')">
          <svg class="chevron" :class="{ open: !sectionState.isCollapsed('remote') }"
               width="10" height="10" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span class="section-label">REMOTE</span>
          <span class="section-count">{{ remoteBranchesFlat.length }}</span>
        </div>
        <template v-if="!sectionState.isCollapsed('remote')">
          <BranchTreeNode
            v-for="root in remoteTree"
            :key="root.path"
            :node="root"
            :level="0"
            @select-branch="onSelectRemoteBranch"
            @dblclick-branch="onDblclickRemoteBranch"
            @branch-context-menu="openContextMenu"
          />
        </template>
      </div>
    </div>

    <!-- Bottom: additional repos (可拖动高度 + 拖动排序) -->
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

    <!-- Submodule kebab context menu -->
    <ContextMenu
      :visible="submoduleMenu.visible"
      :x="submoduleMenu.x"
      :y="submoduleMenu.y"
      :items="submoduleMenuItems"
      @close="closeSubmoduleMenu"
      @select="onSubmoduleMenuAction"
    />

    <!-- Stash context menu -->
    <ContextMenu
      :visible="stashMenu.visible"
      :x="stashMenu.x"
      :y="stashMenu.y"
      :items="stashMenuItems"
      @close="closeStashMenu"
      @select="onStashMenuAction"
    />

    <!-- Tag context menu -->
    <ContextMenu
      :visible="tagMenu.visible"
      :x="tagMenu.x"
      :y="tagMenu.y"
      :items="tagMenuItems"
      @close="closeTagMenu"
      @select="onTagMenuAction"
    />

    <!-- Repo item context menu -->
    <ContextMenu
      :visible="repoMenu.visible"
      :x="repoMenu.x"
      :y="repoMenu.y"
      :items="repoMenuItems"
      @close="closeRepoMenu"
      @select="onRepoMenuAction"
    />

    <!-- Edit submodule dialog -->
    <EditSubmoduleDialog
      :visible="editDialog.visible"
      :submodule="editDialog.target"
      @close="editDialog.visible = false"
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
  font-size: var(--font-base);
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
  font-size: var(--font-xl);
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
  font-size: var(--font-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.section-title.collapsible {
  cursor: pointer;
  gap: 6px;
}

.section-title.collapsible:hover {
  color: var(--text-secondary);
}

.section-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chevron {
  transition: transform 0.15s;
  transform: rotate(0deg);
  flex-shrink: 0;
  color: var(--text-muted);
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
  font-size: var(--font-md);
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
  font-size: var(--font-xs);
  border-radius: 8px;
  padding: 1px 6px;
}

/* ── Branch items ────────────────────────────────────────────────── */
.branch-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 12px 3px 16px;
  font-size: var(--font-md);
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

.stash-item .branch-dot {
  border-color: var(--accent-orange, #f5a97f);
}

.stash-index {
  font-family: var(--code-font-family, 'SF Mono', monospace);
  font-size: var(--font-xs);
  color: var(--text-muted);
  flex-shrink: 0;
}

.stash-item .branch-label {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dot-remote {
  border-color: var(--accent-orange);
  opacity: 0.7;
}

.tag-icon {
  color: var(--accent-orange);
  flex-shrink: 0;
}

.tag-item--lightweight .tag-icon {
  color: var(--text-muted);
}

/* 远程同步状态图标（和 HistoryView 的 chip 图标风格一致） */
.tag-item .tag-status-icon {
  margin-left: auto;
  padding-left: 4px;
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
  flex-shrink: 0;
}
.tag-item .tag-status-icon--synced {
  color: var(--accent-green);
}
.tag-item .tag-status-icon--local {
  color: var(--accent-orange);
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
  font-size: var(--font-xs);
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

/* ── Submodules section ──────────────────────────────────────────── */

.section-count {
  font-size: var(--font-xs);
  font-weight: 600;
  color: var(--accent-blue);
  letter-spacing: 0;
  text-transform: none;
}

.submodule-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px 3px 16px;
  font-size: var(--font-md);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s;
  position: relative;
}

.submodule-item:hover {
  background: var(--bg-overlay);
}

.submodule-item--dim {
  color: var(--text-muted);
  cursor: default;
}

.sub-warn {
  color: var(--accent-orange);
  flex-shrink: 0;
}

.sub-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.submodule-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-orange);
  flex-shrink: 0;
}

.submodule-kebab {
  display: none;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  padding: 2px 4px;
  border-radius: 3px;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  line-height: 0;
  transition: background 0.1s, color 0.1s;
}

.submodule-item:hover .submodule-kebab {
  display: inline-flex;
}

.submodule-kebab:hover {
  background: rgba(138, 173, 244, 0.18);
  color: var(--text-primary);
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
  font-size: var(--font-sm);
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
