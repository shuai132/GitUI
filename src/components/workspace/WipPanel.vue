<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useHistoryStore } from '@/stores/history'
import { useDiffStore } from '@/stores/diff'
import { useUiStore } from '@/stores/ui'
import type { FileEntry } from '@/types/git'
import FileChangeList from '@/components/workspace/FileChangeList.vue'
import Modal from '@/components/common/Modal.vue'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'

const { t } = useI18n()
const workspaceStore = useWorkspaceStore()
const historyStore = useHistoryStore()
const diffStore = useDiffStore()
const uiStore = useUiStore()

// ── 头部统计 ──────────────────────────────────────────────────────
const totalCount = computed(() => {
  const s = workspaceStore.status
  if (!s) return 0
  return s.staged.length + s.unstaged.length + s.untracked.length
})

const branchLabel = computed(() => {
  const s = workspaceStore.status
  if (!s) return 'HEAD'
  if (s.head_branch) return s.head_branch
  if (s.is_detached && s.head_commit) return `(detached ${s.head_commit.slice(0, 7)})`
  if (!s.head_commit) return 'initial commit'
  return 'HEAD'
})

const isUnborn = computed(() => {
  const s = workspaceStore.status
  return !!s && !s.head_commit
})

// ── 合并 unstaged + untracked 列表到一个"未暂存"区 ──────────────────
const unstagedAll = computed<FileEntry[]>(() => {
  const s = workspaceStore.status
  if (!s) return []
  return [...s.unstaged, ...s.untracked]
})

const stagedAll = computed<FileEntry[]>(() => workspaceStore.status?.staged ?? [])

// ── 文件选择 & diff 加载 ──────────────────────────────────────────
const selectedPath = ref<string | null>(null)
const panelListsRef = ref<HTMLElement | null>(null)

/** 合并的文件列表（未暂存 + 已暂存），与视觉顺序一致 */
const allFiles = computed<FileEntry[]>(() => [...unstagedAll.value, ...stagedAll.value])

function onSelectFile(file: FileEntry) {
  selectedPath.value = file.path
  diffStore.loadFileDiff(file.path, file.staged)
  // 选中文件后聚焦列表容器，使键盘导航可用
  panelListsRef.value?.focus()
}

async function onToggleFile(file: FileEntry) {
  if (file.staged) {
    await workspaceStore.unstageFile(file.path)
  } else {
    await workspaceStore.stageFile(file.path)
  }
}

async function onStageAll() {
  await workspaceStore.stageAll()
}

async function onUnstageAll() {
  await workspaceStore.unstageAll()
}

// ── 文件右键菜单 ─────────────────────────────────────────────────
const fileMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  file: null as FileEntry | null,
})

const fileMenuItems = computed<ContextMenuItem[]>(() => {
  const f = fileMenu.file
  if (!f) return []
  return [
    {
      label: f.staged ? t('workspace.wip.menu.unstage') : t('workspace.wip.menu.stage'),
      action: 'toggle',
    },
    { separator: true },
    {
      label: t('workspace.wip.menu.discardFile'),
      action: 'discard',
      danger: true,
      disabled: f.staged,
    },
  ]
})

function onFileContext(e: MouseEvent, file: FileEntry) {
  fileMenu.file = file
  fileMenu.x = e.clientX
  fileMenu.y = e.clientY
  fileMenu.visible = true
}

async function onFileMenuAction(action: string) {
  const f = fileMenu.file
  if (!f) return
  fileMenu.visible = false
  try {
    if (action === 'toggle') {
      await onToggleFile(f)
    } else if (action === 'discard') {
      if (!confirm(t('workspace.confirmDiscard.file', { file: f.path }))) return
      await workspaceStore.discardFile(f.path)
      if (selectedPath.value === f.path) {
        selectedPath.value = null
      }
    }
  } catch (e) {
    alert(String(e))
  }
}

// ── 丢弃全部变更（trash 按钮） ─────────────────────────────────────
const discardConfirmOpen = ref(false)

function onTrashClick() {
  if (totalCount.value === 0) return
  discardConfirmOpen.value = true
}

async function onConfirmDiscardAll() {
  discardConfirmOpen.value = false
  try {
    await workspaceStore.discardAll()
    selectedPath.value = null
  } catch (e) {
    alert(String(e))
  }
}

// 响应外部（AppToolbar Actions / 其他调用方）对"丢弃全部"的粘性请求
function checkDiscardAllRequest() {
  if (uiStore.shouldOpenDiscardAll && totalCount.value > 0) {
    discardConfirmOpen.value = true
    uiStore.consumeDiscardAllRequest()
  } else if (uiStore.shouldOpenDiscardAll) {
    // 没有可丢弃的变更也要消费标志，避免悬空
    uiStore.consumeDiscardAllRequest()
  }
}
onMounted(() => {
  checkDiscardAllRequest()
  // 首次进入 WIP：若尚未选中任何文件，自动选中第一个
  // （顺序：未暂存 + 未跟踪 → 已暂存，与视觉列表一致）
  if (!selectedPath.value && allFiles.value.length > 0) {
    const first = allFiles.value[0]
    selectedPath.value = first.path
    diffStore.loadFileDiff(first.path, first.staged)
  }
})
watch(() => uiStore.shouldOpenDiscardAll, checkDiscardAllRequest)

// ── 提交表单 ──────────────────────────────────────────────────────
const amendChecked = ref(false)
const message = computed({
  get: () => workspaceStore.commitDraft,
  set: (v: string) => {
    workspaceStore.commitDraft = v
  },
})
const committing = ref(false)
const commitError = ref<string | null>(null)

const canCommit = computed(() => {
  if (committing.value) return false
  if (message.value.trim().length === 0) return false
  // 普通提交：必须有暂存文件；amend：HEAD 必须存在 + 允许无新增暂存
  if (amendChecked.value) return !isUnborn.value
  return stagedAll.value.length > 0
})

const commitButtonLabel = computed(() => {
  if (committing.value) return t('workspace.commit.button.committing')
  if (amendChecked.value) return t('workspace.commit.button.amend')
  if (stagedAll.value.length === 0) return t('workspace.commit.button.stageFirst')
  return t('workspace.commit.button.commitCount', { count: stagedAll.value.length })
})

// amend 勾选时自动填充上次提交信息
watch(amendChecked, (checked) => {
  const headMsg = workspaceStore.status?.head_commit_message ?? ''
  if (checked) {
    if (message.value.trim() === '') {
      message.value = headMsg
    }
  } else {
    if (message.value === headMsg) {
      message.value = ''
    }
  }
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
    message.value = ''
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
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    onCommit()
  }
}

const messageInputRef = ref<HTMLTextAreaElement | null>(null)

function autoResizeInput() {
  const el = messageInputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

// ── 未暂存/已暂存分割线拖拽 ────────────────────────────────────────
const WIP_SPLIT_KEY = 'wip-split-pct'
const splitPct = ref(parseFloat(localStorage.getItem(WIP_SPLIT_KEY) || '50'))

function startSplitResize(e: PointerEvent) {
  e.preventDefault()
  const container = panelListsRef.value
  if (!container) return
  const startY = e.clientY
  const startH = container.getBoundingClientRect().height
  const startPct = splitPct.value

  const onMove = (ev: PointerEvent) => {
    const delta = ev.clientY - startY
    const next = startPct + (delta / startH) * 100
    splitPct.value = Math.max(15, Math.min(85, next))
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem(WIP_SPLIT_KEY, String(splitPct.value))
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}

// ── 键盘上下键导航 ──────────────────────────────────────────────
function onListKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
  e.preventDefault()
  e.stopPropagation()

  const list = allFiles.value
  if (list.length === 0) return

  const currentIdx = selectedPath.value
    ? list.findIndex((f) => f.path === selectedPath.value)
    : -1

  let nextIdx: number
  if (e.key === 'ArrowDown') {
    nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, list.length - 1)
  } else {
    nextIdx = currentIdx < 0 ? 0 : Math.max(currentIdx - 1, 0)
  }

  const next = list[nextIdx]
  selectedPath.value = next.path
  diffStore.loadFileDiff(next.path, next.staged)

  // 滚动选中项到可视区域
  const entry = panelListsRef.value?.querySelectorAll('.file-entry')[nextIdx] as HTMLElement | undefined
  entry?.scrollIntoView({ block: 'nearest' })
}

// ── 工作区刷新时清理失效的 selectedPath ─────────────────────────
watch(
  () => workspaceStore.status,
  (s) => {
    if (!selectedPath.value || !s) return
    const allPaths = [...s.staged, ...s.unstaged, ...s.untracked].map((f) => f.path)
    if (!allPaths.includes(selectedPath.value)) {
      selectedPath.value = null
    }
  },
)
</script>

<template>
  <div class="wip-panel">
    <!-- Header -->
    <div class="panel-header">
      <button
        class="btn-trash"
        :disabled="totalCount === 0"
        :title="t('workspace.wip.discardAllTitle')"
        @click="onTrashClick"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
      <span class="header-title">
        {{ t('workspace.wip.headerTitle', { count: totalCount }) }}
        <span class="header-branch">{{ t('workspace.wip.onBranch', { branch: branchLabel }) }}</span>
      </span>
    </div>

    <!-- 文件列表区 -->
    <div ref="panelListsRef" class="panel-lists" tabindex="-1" @keydown="onListKeydown">
      <div class="split-top" :style="{ flex: `${splitPct} 0 0%` }">
        <FileChangeList
          :files="unstagedAll"
          :title="t('workspace.wip.section.unstaged')"
          :empty-text="t('workspace.wip.empty.unstaged')"
          :show-row-actions="true"
          :selected-path="selectedPath"
          variant="unstaged"
          @select="onSelectFile"
          @toggle="onToggleFile"
          @context-menu="onFileContext"
        >
          <template #header-actions>
            <button
              v-if="unstagedAll.length > 0"
              class="btn-section"
              @click="onStageAll"
            >
              {{ t('workspace.wip.stageAll') }}
            </button>
          </template>
        </FileChangeList>
      </div>

      <div class="split-resize" @pointerdown="startSplitResize" />

      <div class="split-bottom" :style="{ flex: `${100 - splitPct} 0 0%` }">
        <FileChangeList
          :files="stagedAll"
          :title="t('workspace.wip.section.staged')"
          :empty-text="t('workspace.wip.empty.staged')"
          :show-row-actions="true"
          :selected-path="selectedPath"
          variant="staged"
          @select="onSelectFile"
          @toggle="onToggleFile"
          @context-menu="onFileContext"
        >
          <template #header-actions>
            <button
              v-if="stagedAll.length > 0"
              class="btn-section"
              @click="onUnstageAll"
            >
              {{ t('workspace.wip.unstageAll') }}
            </button>
          </template>
        </FileChangeList>
      </div>
    </div>

    <!-- 提交表单 -->
    <div class="commit-form">
      <textarea
        ref="messageInputRef"
        v-model="message"
        class="message-input"
        rows="1"
        :placeholder="t('workspace.commit.messagePlaceholder')"
        spellcheck="false"
        autocomplete="off"
        @keydown="onMessageKeydown"
        @input="autoResizeInput"
      />
      <div class="commit-actions">
        <label class="amend-row" :title="t('workspace.commit.amendLabel')">
          <input
            type="checkbox"
            v-model="amendChecked"
            :disabled="isUnborn"
          />
          <span>Amend</span>
        </label>
        <button
          class="btn-commit"
          :disabled="!canCommit"
          @click="onCommit"
        >
          {{ commitButtonLabel }}
        </button>
      </div>
      <div v-if="commitError" class="commit-error">{{ commitError }}</div>
    </div>

    <!-- 丢弃全部变更确认框 -->
    <Modal
      :visible="discardConfirmOpen"
      :title="t('workspace.confirmDiscard.allTitle')"
      width="400px"
      @close="discardConfirmOpen = false"
    >
      <div class="discard-body">
        <p>{{ t('workspace.confirmDiscard.intro') }}</p>
        <ul>
          <li>{{ t('workspace.confirmDiscard.unstagedCount', { count: workspaceStore.status?.unstaged.length ?? 0 }) }}</li>
          <li>{{ t('workspace.confirmDiscard.untrackedCount', { count: workspaceStore.status?.untracked.length ?? 0 }) }}</li>
          <li>{{ t('workspace.confirmDiscard.stagedCount', { count: stagedAll.length }) }}</li>
        </ul>
        <p class="warn">
          {{ t('workspace.confirmDiscard.warnIrreversible') }}
          <code>.gitignore</code>
          {{ t('workspace.confirmDiscard.warnIgnored') }}
        </p>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="discardConfirmOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger" @click="onConfirmDiscardAll">{{ t('workspace.confirmDiscard.confirmAll') }}</button>
      </template>
    </Modal>

    <!-- 文件右键菜单 -->
    <ContextMenu
      :visible="fileMenu.visible"
      :x="fileMenu.x"
      :y="fileMenu.y"
      :items="fileMenuItems"
      @close="fileMenu.visible = false"
      @select="onFileMenuAction"
    />
  </div>
</template>

<style scoped>
.wip-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 2px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  height: 28px;
}

.btn-trash {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--accent-red);
  cursor: pointer;
  padding: 4px 5px;
  display: flex;
  align-items: center;
  transition: background 0.15s, border-color 0.15s;
}

.btn-trash:hover:not(:disabled) {
  background: rgba(237, 135, 150, 0.15);
  border-color: var(--accent-red);
}

.btn-trash:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.header-title {
  font-size: var(--font-md);
  color: var(--text-primary);
  font-weight: 600;
}

.header-branch {
  color: var(--text-muted);
  font-weight: 400;
  margin-left: 4px;
}

.panel-lists {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  outline: none;
}

.split-top,
.split-bottom {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.split-resize {
  height: 4px;
  flex-shrink: 0;
  cursor: row-resize;
  background: transparent;
  border-top: 1px solid var(--border);
  position: relative;
  z-index: 1;
  transition: background 0.15s;
}

.split-resize:hover,
.split-resize:active {
  background: rgba(138, 173, 244, 0.3);
}

.btn-section {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--font-xs);
  padding: 0 5px;
  line-height: 14px;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}

.btn-section:hover {
  background: var(--accent-blue);
  color: var(--bg-primary);
  border-color: var(--accent-blue);
}

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
  overflow: hidden;
  line-height: 1.4;
  max-height: 120px;
}

.message-input:focus {
  border-color: var(--accent-blue);
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

.discard-body {
  font-size: var(--font-md);
  color: var(--text-secondary);
  line-height: 1.6;
}

.discard-body ul {
  margin: 8px 0;
  padding-left: 18px;
}

.discard-body .warn {
  margin-top: 10px;
  color: var(--accent-orange);
}

.discard-body code {
  background: var(--bg-overlay);
  padding: 0 4px;
  border-radius: 3px;
  font-family: var(--code-font-family, 'SF Mono', monospace);
  font-size: var(--font-sm);
}

.btn {
  padding: 6px 18px;
  border-radius: 5px;
  font-family: inherit;
  font-size: var(--font-md);
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.btn-secondary {
  background: var(--bg-overlay);
  color: var(--text-primary);
  border-color: var(--border);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-primary);
}

.btn-danger {
  background: var(--accent-red);
  color: var(--bg-primary);
  font-weight: 600;
}

.btn-danger:hover:not(:disabled) {
  filter: brightness(1.1);
}
</style>
