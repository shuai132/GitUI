<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useHistoryStore } from '@/stores/history'
import { useDiffStore } from '@/stores/diff'
import { useUiStore } from '@/stores/ui'
import type { FileEntry } from '@/types/git'
import FileChangeList from '@/components/workspace/FileChangeList.vue'
import Modal from '@/components/common/Modal.vue'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'

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
      label: f.staged ? '取消暂存' : '暂存文件',
      action: 'toggle',
    },
    { separator: true },
    {
      label: '丢弃此文件的变更',
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
      if (!confirm(`丢弃 "${f.path}" 的工作区变更？`)) return
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
onMounted(checkDiscardAllRequest)
watch(() => uiStore.shouldOpenDiscardAll, checkDiscardAllRequest)

// ── 提交表单 ──────────────────────────────────────────────────────
const amendChecked = ref(false)
const message = ref('')
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
  if (committing.value) return '提交中...'
  if (amendChecked.value) return '修补上次提交'
  if (stagedAll.value.length === 0) return '暂存变更后提交'
  return `提交 ${stagedAll.value.length} 个变更`
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
    if (amendChecked.value) {
      await workspaceStore.amend(msg)
    } else {
      await workspaceStore.commit(msg)
    }
    message.value = ''
    amendChecked.value = false
    await historyStore.loadLog()
    await historyStore.loadBranches()
  } catch (e) {
    commitError.value = String(e)
  } finally {
    committing.value = false
  }
}

function onMessageKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    onCommit()
  }
}

// ── 提交表单高度拖拽 ─────────────────────────────────────────────
const COMMIT_FORM_H_KEY = 'wip-commit-form-height'
const commitFormH = ref(parseInt(localStorage.getItem(COMMIT_FORM_H_KEY) || '0', 10) || 0)
const wipPanelRef = ref<HTMLElement | null>(null)

function startCommitResize(e: PointerEvent) {
  e.preventDefault()
  const startY = e.clientY
  const panelEl = wipPanelRef.value
  if (!panelEl) return
  const formEl = panelEl.querySelector('.commit-form') as HTMLElement | null
  if (!formEl) return
  const startH = formEl.offsetHeight

  const onMove = (ev: PointerEvent) => {
    const delta = startY - ev.clientY
    const maxH = panelEl.clientHeight - 80
    commitFormH.value = Math.max(100, Math.min(maxH, startH + delta))
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (commitFormH.value > 0) {
      localStorage.setItem(COMMIT_FORM_H_KEY, String(commitFormH.value))
    }
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
  <div ref="wipPanelRef" class="wip-panel">
    <!-- Header -->
    <div class="panel-header">
      <button
        class="btn-trash"
        :disabled="totalCount === 0"
        title="丢弃所有变更"
        @click="onTrashClick"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
      <span class="header-title">
        {{ totalCount }} 个文件变更
        <span class="header-branch">on {{ branchLabel }}</span>
      </span>
    </div>

    <!-- 文件列表区 -->
    <div ref="panelListsRef" class="panel-lists" tabindex="-1" @keydown="onListKeydown">
      <FileChangeList
        :files="unstagedAll"
        title="未暂存"
        empty-text="无未暂存变更"
        :show-row-actions="true"
        :selected-path="selectedPath"
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
            全部暂存
          </button>
        </template>
      </FileChangeList>

      <FileChangeList
        :files="stagedAll"
        title="已暂存"
        empty-text="无暂存文件"
        :show-row-actions="true"
        :selected-path="selectedPath"
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
            全部取消暂存
          </button>
        </template>
      </FileChangeList>
    </div>

    <!-- 拖拽分隔条 -->
    <div class="commit-resize" @pointerdown="startCommitResize" />

    <!-- 提交表单 -->
    <div class="commit-form" :style="commitFormH > 0 ? { height: commitFormH + 'px' } : {}">
      <label class="amend-row">
        <input
          type="checkbox"
          v-model="amendChecked"
          :disabled="isUnborn"
        />
        <span>修补上次提交 (Amend)</span>
        <span v-if="isUnborn" class="amend-hint">（尚无历史提交）</span>
      </label>

      <textarea
        v-model="message"
        class="message-input"
        rows="3"
        placeholder="提交信息（Cmd+Enter 提交）"
        spellcheck="false"
        autocomplete="off"
        @keydown="onMessageKeydown"
      />

      <div v-if="commitError" class="commit-error">{{ commitError }}</div>

      <button
        class="btn-commit"
        :disabled="!canCommit"
        @click="onCommit"
      >
        {{ commitButtonLabel }}
      </button>
    </div>

    <!-- 丢弃全部变更确认框 -->
    <Modal
      :visible="discardConfirmOpen"
      title="丢弃所有变更？"
      width="400px"
      @close="discardConfirmOpen = false"
    >
      <div class="discard-body">
        <p>将丢弃所有未暂存变更并删除未跟踪文件：</p>
        <ul>
          <li>未暂存：{{ (workspaceStore.status?.unstaged.length ?? 0) }} 个</li>
          <li>未跟踪：{{ (workspaceStore.status?.untracked.length ?? 0) }} 个</li>
          <li>已暂存：{{ stagedAll.length }} 个（将一并恢复）</li>
        </ul>
        <p class="warn">
          此操作不可撤销。<code>.gitignore</code> 里的文件不会被删除。
        </p>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="discardConfirmOpen = false">取消</button>
        <button class="btn btn-danger" @click="onConfirmDiscardAll">丢弃全部</button>
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
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
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
  overflow-y: auto;
  min-height: 0;
  outline: none;
}

.btn-section {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--font-xs);
  padding: 2px 8px;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}

.btn-section:hover {
  background: var(--accent-blue);
  color: var(--bg-primary);
  border-color: var(--accent-blue);
}

.commit-resize {
  height: 6px;
  margin-top: -3px;
  margin-bottom: -3px;
  cursor: row-resize;
  background: transparent;
  transition: background 0.15s;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.commit-resize:hover,
.commit-resize:active {
  background: rgba(138, 173, 244, 0.3);
}

.commit-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
  flex-shrink: 0;
  overflow: hidden;
}

.amend-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.amend-row input[type='checkbox'] {
  cursor: pointer;
  accent-color: var(--accent-blue);
}

.amend-row input:disabled {
  cursor: not-allowed;
}

.amend-hint {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.message-input {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-md);
  padding: 6px 8px;
  resize: none;
  outline: none;
  transition: border-color 0.15s;
  flex: 1;
  min-height: 0;
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
  padding: 7px 16px;
  font-size: var(--font-md);
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
