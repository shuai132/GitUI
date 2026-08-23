<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BlobData, DocumentTextSource, FileDiff, FileStatusKind } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import {
  buildDocumentDiffGroups,
  buildDocumentDiffRows,
  buildDocumentInlineRows,
  hasDocumentDiffChanges,
} from '@/lib/documentDiff'
import { mimeFor } from '@/lib/preview'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  diff: FileDiff
  repoId: string
  documentKind: 'pdf' | 'docx' | 'pptx'
  wip?: { staged: boolean; status?: FileStatusKind } | null
}>()

interface DocumentSideState {
  present: boolean
  loading: boolean
  error: string | null
  objectUrl: string | null
  text: string
  bytesTruncated: boolean
  textTruncated: boolean
}

interface SideLoadTarget {
  source: DocumentTextSource | null
  path: string | null
}

const { t } = useI18n()
const uiStore = useUiStore()
const { getBlobBytes, readWorktreeFile, extractDocumentText } = useGitCommands()

const DOCUMENT_PREVIEW_SPLIT_KEY = 'gitui.diff.documentPreviewPct'
const DOCUMENT_PREVIEW_DEFAULT_PCT = 45
const DOCUMENT_PREVIEW_MIN_PCT = 15
const DOCUMENT_PREVIEW_MAX_PCT = 85

const documentDiffRef = ref<HTMLElement | null>(null)
const oldSide = ref<DocumentSideState>(emptySide())
const newSide = ref<DocumentSideState>(emptySide())
const previewPct = ref(loadDocumentPreviewPct())
const isDocumentSplitResizing = ref(false)
let loadSeq = 0
let stopDocumentSplitResize: (() => void) | null = null

const rows = computed(() => buildDocumentDiffRows(oldSide.value.text, newSide.value.text))
const hasChanges = computed(() => hasDocumentDiffChanges(rows.value))
const rowGroups = computed(() => {
  if (uiStore.diffGroupByHunk) return buildDocumentDiffGroups(rows.value)
  return rows.value.length === 0 ? [] : [{ header: '', rows: rows.value }]
})
const useSideBySideTextDiff = computed(() => uiStore.diffLayoutMode === 'side-by-side')
const hasText = computed(() => oldSide.value.text.length > 0 || newSide.value.text.length > 0)
const loading = computed(() => oldSide.value.loading || newSide.value.loading)
const isPdf = computed(() => props.documentKind === 'pdf')

watch(
  () => [
    props.diff,
    props.repoId,
    props.diff.old_blob_oid,
    props.diff.new_blob_oid,
    props.diff.old_path,
    props.diff.new_path,
    props.wip?.staged,
    props.documentKind,
  ] as const,
  () => {
    void loadDocument()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  revokeSide(oldSide.value)
  revokeSide(newSide.value)
  stopDocumentSplitResize?.()
})

async function loadDocument() {
  const seq = ++loadSeq
  const oldTarget = sideTarget('old')
  const newTarget = sideTarget('new')

  oldSide.value = loadingSide(Boolean(oldTarget.source))
  newSide.value = loadingSide(Boolean(newTarget.source))

  const [oldResult, newResult] = await Promise.all([
    loadSide(oldTarget),
    loadSide(newTarget),
  ])
  if (seq !== loadSeq) {
    revokeSide(oldResult)
    revokeSide(newResult)
    return
  }

  revokeSide(oldSide.value)
  revokeSide(newSide.value)
  oldSide.value = oldResult
  newSide.value = newResult
}

async function loadSide(target: SideLoadTarget): Promise<DocumentSideState> {
  if (!target.source || !target.path) return emptySide()

  const state = loadingSide(true)
  try {
    if (isPdf.value) {
      const blob = await loadBytes(target.source)
      state.bytesTruncated = blob.truncated
      if (!blob.truncated) {
        state.objectUrl = URL.createObjectURL(
          new Blob([base64ToBytes(blob.bytes_base64)], { type: mimeFor(target.path) }),
        )
      }
    }

    const extracted = await extractDocumentText(props.repoId, target.source, true)
    state.text = extracted.text
    state.textTruncated = extracted.truncated
  } catch (e: unknown) {
    state.error = String(e)
  } finally {
    state.loading = false
  }
  return state
}

async function loadBytes(source: DocumentTextSource): Promise<BlobData> {
  if (source.kind === 'blob') {
    return getBlobBytes(props.repoId, source.oid, true)
  }
  return readWorktreeFile(props.repoId, source.rel_path, true)
}

function sideTarget(side: 'old' | 'new'): SideLoadTarget {
  if (side === 'old') {
    const path = props.diff.old_path ?? props.diff.new_path ?? null
    if (!props.diff.old_blob_oid || !path) return { source: null, path }
    return {
      source: { kind: 'blob', oid: props.diff.old_blob_oid, path },
      path,
    }
  }

  const path = props.diff.new_path ?? props.diff.old_path ?? null
  if (props.wip && !props.wip.staged && props.diff.new_path && diffHasNewSide(props.diff)) {
    return {
      source: { kind: 'worktree', rel_path: props.diff.new_path },
      path: props.diff.new_path,
    }
  }
  if (!props.diff.new_blob_oid || !path) return { source: null, path }
  return {
    source: { kind: 'blob', oid: props.diff.new_blob_oid, path },
    path,
  }
}

function diffHasNewSide(diff: FileDiff): boolean {
  if (diff.new_blob_oid) return true
  return diff.hunks.some((hunk) => hunk.new_lines > 0)
}

function emptySide(): DocumentSideState {
  return {
    present: false,
    loading: false,
    error: null,
    objectUrl: null,
    text: '',
    bytesTruncated: false,
    textTruncated: false,
  }
}

function loadingSide(present: boolean): DocumentSideState {
  return {
    ...emptySide(),
    present,
    loading: present,
  }
}

function revokeSide(side: DocumentSideState) {
  if (side.objectUrl) URL.revokeObjectURL(side.objectUrl)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function loadDocumentPreviewPct(): number {
  const raw = localStorage.getItem(DOCUMENT_PREVIEW_SPLIT_KEY)
  if (raw === null) return DOCUMENT_PREVIEW_DEFAULT_PCT

  const saved = Number(raw)
  return Number.isFinite(saved)
    ? clampDocumentPreviewPct(saved)
    : DOCUMENT_PREVIEW_DEFAULT_PCT
}

function clampDocumentPreviewPct(value: number): number {
  return Math.max(DOCUMENT_PREVIEW_MIN_PCT, Math.min(DOCUMENT_PREVIEW_MAX_PCT, value))
}

function startDocumentSplitResize(e: PointerEvent) {
  e.preventDefault()
  stopDocumentSplitResize?.()

  const container = documentDiffRef.value
  if (!container) return

  const startY = e.clientY
  const startH = container.getBoundingClientRect().height
  const startPct = previewPct.value
  if (startH <= 0) return

  const onMove = (ev: PointerEvent) => {
    ev.preventDefault()
    const delta = ev.clientY - startY
    previewPct.value = clampDocumentPreviewPct(startPct + (delta / startH) * 100)
  }
  const stopResize = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', stopResize)
    window.removeEventListener('pointercancel', stopResize)
    window.removeEventListener('blur', stopResize)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem(DOCUMENT_PREVIEW_SPLIT_KEY, String(previewPct.value))
    isDocumentSplitResizing.value = false
    stopDocumentSplitResize = null
  }

  if (e.currentTarget instanceof HTMLElement && typeof e.currentTarget.setPointerCapture === 'function') {
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  isDocumentSplitResizing.value = true
  stopDocumentSplitResize = stopResize
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('pointercancel', stopResize)
  window.addEventListener('blur', stopResize)
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}

function onDocumentSplitKeydown(e: KeyboardEvent) {
  let next = previewPct.value
  if (e.key === 'ArrowUp') next -= 5
  else if (e.key === 'ArrowDown') next += 5
  else if (e.key === 'Home') next = DOCUMENT_PREVIEW_MIN_PCT
  else if (e.key === 'End') next = DOCUMENT_PREVIEW_MAX_PCT
  else return

  e.preventDefault()
  previewPct.value = clampDocumentPreviewPct(next)
  localStorage.setItem(DOCUMENT_PREVIEW_SPLIT_KEY, String(previewPct.value))
}

</script>

<template>
  <div ref="documentDiffRef" class="document-diff">
    <div class="document-preview-grid" :style="{ flex: `${previewPct} 0 0%` }">
      <section class="document-pane">
        <div class="pane-header">{{ t('diff.image.oldSide') }}</div>
        <div class="pane-body">
          <div v-if="oldSide.loading" class="pane-state">{{ t('diff.empty.loading') }}</div>
          <div v-else-if="!oldSide.present" class="pane-state empty">{{ t('diff.image.added') }}</div>
          <div v-else-if="oldSide.error" class="pane-state error">{{ t('diff.document.loadFailed', { detail: oldSide.error }) }}</div>
          <div v-else-if="oldSide.bytesTruncated" class="pane-state">{{ t('diff.document.previewTooLarge') }}</div>
          <iframe v-else-if="isPdf && oldSide.objectUrl" class="pdf-frame" :src="oldSide.objectUrl" />
          <pre v-else class="office-text">{{ oldSide.text || t('diff.document.noText') }}</pre>
        </div>
      </section>

      <section class="document-pane">
        <div class="pane-header">{{ t('diff.image.newSide') }}</div>
        <div class="pane-body">
          <div v-if="newSide.loading" class="pane-state">{{ t('diff.empty.loading') }}</div>
          <div v-else-if="!newSide.present" class="pane-state empty">{{ t('diff.image.deleted') }}</div>
          <div v-else-if="newSide.error" class="pane-state error">{{ t('diff.document.loadFailed', { detail: newSide.error }) }}</div>
          <div v-else-if="newSide.bytesTruncated" class="pane-state">{{ t('diff.document.previewTooLarge') }}</div>
          <iframe v-else-if="isPdf && newSide.objectUrl" class="pdf-frame" :src="newSide.objectUrl" />
          <pre v-else class="office-text">{{ newSide.text || t('diff.document.noText') }}</pre>
        </div>
      </section>
    </div>

    <div
      class="document-split-resize"
      role="separator"
      :aria-label="t('diff.document.resizePreviewText')"
      aria-orientation="horizontal"
      :aria-valuemin="DOCUMENT_PREVIEW_MIN_PCT"
      :aria-valuemax="DOCUMENT_PREVIEW_MAX_PCT"
      :aria-valuenow="previewPct"
      tabindex="0"
      @pointerdown="startDocumentSplitResize"
      @keydown="onDocumentSplitKeydown"
    />

    <div
      v-if="isDocumentSplitResizing"
      class="document-split-overlay"
      @pointermove.prevent
      @pointerup.prevent="stopDocumentSplitResize?.()"
      @pointercancel.prevent="stopDocumentSplitResize?.()"
    />

    <div class="document-text-diff" :style="{ flex: `${100 - previewPct} 0 0%` }">
      <div class="text-diff-header">
        <span>{{ t('diff.document.extractedTextDiff') }}</span>
        <span v-if="oldSide.textTruncated || newSide.textTruncated" class="truncated">
          {{ t('diff.document.textTruncated') }}
        </span>
      </div>
      <div v-if="loading" class="text-state">{{ t('diff.empty.loading') }}</div>
      <div v-else-if="!hasText" class="text-state">{{ t('diff.document.noText') }}</div>
      <div v-else-if="!hasChanges" class="text-state">{{ t('diff.empty.noChanges') }}</div>
      <table v-else-if="useSideBySideTextDiff" class="text-table text-table--side-by-side">
        <colgroup>
          <col class="line-col">
          <col class="side-content-col">
          <col class="line-col">
          <col class="side-content-col">
        </colgroup>
        <tbody>
          <template v-for="(group, groupIndex) in rowGroups" :key="groupIndex">
            <tr v-if="uiStore.diffGroupByHunk" class="hunk-row">
              <td colspan="4">{{ group.header }}</td>
            </tr>
            <tr v-for="(row, rowIndex) in group.rows" :key="`${groupIndex}-${rowIndex}`">
              <td class="line-no">{{ row.left.lineNo ?? '' }}</td>
              <td class="line-cell" :class="row.left.kind" v-html="row.left.html" />
              <td class="line-no">{{ row.right.lineNo ?? '' }}</td>
              <td class="line-cell" :class="row.right.kind" v-html="row.right.html" />
            </tr>
          </template>
        </tbody>
      </table>
      <div v-else class="inline-list">
        <template v-for="(group, groupIndex) in rowGroups" :key="groupIndex">
          <div v-if="uiStore.diffGroupByHunk" class="inline-hunk-header">{{ group.header }}</div>
          <div
            v-for="(row, rowIndex) in buildDocumentInlineRows(group.rows)"
            :key="`${groupIndex}-${rowIndex}`"
            class="inline-row"
            :class="row.kind"
          >
            <span class="inline-line-no">{{ row.oldLineNo ?? '' }}</span>
            <span class="inline-line-no">{{ row.newLineNo ?? '' }}</span>
            <span class="inline-content" v-html="row.html" />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.document-diff {
  display: flex;
  flex-direction: column;
  position: relative;
  height: 100%;
  min-height: 0;
  background: var(--bg-primary);
}

.document-preview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  flex-shrink: 0;
  min-height: 0;
  overflow: hidden;
}

.document-split-resize {
  height: 4px;
  flex-shrink: 0;
  cursor: row-resize;
  background: transparent;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  position: relative;
  z-index: 2;
  transition: background 0.15s;
}

.document-split-resize:hover,
.document-split-resize:active {
  background: rgba(138, 173, 244, 0.3);
}

.document-split-resize:focus-visible {
  outline: 1px solid var(--accent-blue);
  outline-offset: -1px;
  background: rgba(138, 173, 244, 0.3);
}

.document-split-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  cursor: row-resize;
  background: transparent;
}

.document-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border);
}

.document-pane:last-child {
  border-right: none;
}

.pane-header,
.text-diff-header {
  height: 24px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 11px;
  flex-shrink: 0;
}

.pane-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.pdf-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #ffffff;
}

.office-text {
  margin: 0;
  padding: 12px;
  min-height: 100%;
  white-space: pre-wrap;
  color: var(--text-primary);
  font-family: var(--code-font-family);
  font-size: 12px;
  line-height: 1.5;
  user-select: text;
}

.pane-state,
.text-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}

.pane-state.error {
  color: var(--accent-red);
}

.document-text-diff {
  min-height: 0;
  overflow: auto;
}

.text-diff-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.truncated {
  color: var(--accent-yellow);
}

.text-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-family: var(--code-font-family);
  font-size: 12px;
  line-height: 18px;
}

.line-col {
  width: 52px;
}

.side-content-col {
  width: calc((100% - 104px) / 2);
}

.hunk-row td {
  padding: 3px 8px;
  color: var(--accent-blue);
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}

.line-no {
  padding: 0 8px;
  color: var(--text-muted);
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--border);
  background: var(--bg-secondary);
}

.line-cell {
  padding: 0 8px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  user-select: text;
}

.line-cell.del {
  background: var(--diff-del-bg);
}

.line-cell.add {
  background: var(--diff-add-bg);
}

.line-cell.empty {
  background: var(--diff-empty-bg);
}

.inline-list {
  font-family: var(--code-font-family);
  font-size: 12px;
  line-height: 18px;
}

.inline-hunk-header {
  padding: 3px 8px;
  color: var(--accent-blue);
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}

.inline-row {
  display: grid;
  grid-template-columns: 52px 52px minmax(0, 1fr);
  min-height: 18px;
}

.inline-line-no {
  padding: 0 8px;
  color: var(--text-muted);
  text-align: right;
  user-select: none;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
}

.inline-content {
  min-width: 0;
  padding: 0 8px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  user-select: text;
}

.inline-row.del .inline-content {
  background: var(--diff-del-bg);
}

.inline-row.add .inline-content {
  background: var(--diff-add-bg);
}
</style>
