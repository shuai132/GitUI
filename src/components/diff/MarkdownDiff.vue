<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { FileDiff, FileStatusKind } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useUiStore } from '@/stores/ui'
import { diffHasNewSide, loadDiffSideText } from '@/lib/diffText'
import type { FullFileContent } from '@/lib/fullFileDiff'
import { isSafeExternalMarkdownUrl, renderMarkdownPreview } from '@/lib/markdownPreview'
import SideBySideDiff from './SideBySideDiff.vue'
import InlineDiff from './InlineDiff.vue'
import type { SyntaxLangResolver } from '@/lib/highlight'

const props = defineProps<{
  diff: FileDiff
  repoId: string
  wip?: { staged: boolean; status?: FileStatusKind } | null
  syntaxLang?: string | null
  syntaxLangForLine?: SyntaxLangResolver | null
  scrollResetKey?: string | null
  hunkActionLabel?: string | null
  hunkDiscardLabel?: string | null
}>()

const emit = defineEmits<{
  'hunk-action': [hunkIndex: number]
  'hunk-discard': [hunkIndex: number]
}>()

interface MarkdownSideState {
  present: boolean
  loading: boolean
  text: string | null
}

interface DiffScrollAnchor {
  oldLineNo?: number
  newLineNo?: number
}

const { t } = useI18n()
const uiStore = useUiStore()
const { getBlobBytes, readWorktreeFile } = useGitCommands()

const MARKDOWN_PREVIEW_SPLIT_KEY = 'gitui.diff.markdownPreviewPct'
const MARKDOWN_PREVIEW_DEFAULT_PCT = 45
const MARKDOWN_PREVIEW_MIN_PCT = 15
const MARKDOWN_PREVIEW_MAX_PCT = 85

const markdownDiffRef = ref<HTMLElement | null>(null)
const oldSide = ref<MarkdownSideState>(emptySide())
const newSide = ref<MarkdownSideState>(emptySide())
const previewPct = ref(loadMarkdownPreviewPct())
const isMarkdownSplitResizing = ref(false)
const diffRef = ref<{
  goNextChange: () => void
  goPrevChange: () => void
  getScrollAnchor: () => DiffScrollAnchor | null
  scrollToLine: (anchor: DiffScrollAnchor) => void
} | null>(null)
let loadSeq = 0
let stopMarkdownSplitResize: (() => void) | null = null

const fullFileContent = computed<FullFileContent | null>(() => {
  if (oldSide.value.text == null || newSide.value.text == null) return null
  return {
    oldText: oldSide.value.text,
    newText: newSide.value.text,
  }
})
const oldPreviewHtml = computed(() => renderSideMarkdown(oldSide.value))
const newPreviewHtml = computed(() => renderSideMarkdown(newSide.value))

watch(
  () => [
    props.diff,
    props.repoId,
    props.diff.old_blob_oid,
    props.diff.new_blob_oid,
    props.diff.old_path,
    props.diff.new_path,
    props.diff.encoding,
    props.wip?.staged,
  ] as const,
  () => {
    void loadMarkdown()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopMarkdownSplitResize?.()
})

async function loadMarkdown() {
  const seq = ++loadSeq
  oldSide.value = loadingSide(hasOldSide())
  newSide.value = loadingSide(hasNewSide())

  const [oldText, newText] = await Promise.all([
    oldSide.value.present ? loadSideText('old') : Promise.resolve(''),
    newSide.value.present ? loadSideText('new') : Promise.resolve(''),
  ])
  if (seq !== loadSeq) return

  oldSide.value = loadedSide(oldSide.value.present, oldText)
  newSide.value = loadedSide(newSide.value.present, newText)
}

function loadSideText(side: 'old' | 'new'): Promise<string | null> {
  return loadDiffSideText({
    repoId: props.repoId,
    diff: props.diff,
    wip: props.wip ?? null,
    getBlobBytes,
    readWorktreeFile,
  }, side)
}

function hasOldSide(): boolean {
  return Boolean(props.diff.old_blob_oid)
}

function hasNewSide(): boolean {
  if (props.wip && !props.wip.staged && props.diff.new_path) return diffHasNewSide(props.diff)
  return Boolean(props.diff.new_blob_oid)
}

function emptySide(): MarkdownSideState {
  return {
    present: false,
    loading: false,
    text: null,
  }
}

function loadingSide(present: boolean): MarkdownSideState {
  return {
    present,
    loading: present,
    text: null,
  }
}

function loadedSide(present: boolean, text: string | null): MarkdownSideState {
  return {
    present,
    loading: false,
    text,
  }
}

function renderSideMarkdown(side: MarkdownSideState): string {
  if (!side.present || side.loading || side.text == null) return ''
  return renderMarkdownPreview(side.text, uiStore.diffHighlightEnabled)
}

function loadMarkdownPreviewPct(): number {
  const raw = localStorage.getItem(MARKDOWN_PREVIEW_SPLIT_KEY)
  if (raw === null) return MARKDOWN_PREVIEW_DEFAULT_PCT

  const saved = Number(raw)
  return Number.isFinite(saved)
    ? clampMarkdownPreviewPct(saved)
    : MARKDOWN_PREVIEW_DEFAULT_PCT
}

function clampMarkdownPreviewPct(value: number): number {
  return Math.max(MARKDOWN_PREVIEW_MIN_PCT, Math.min(MARKDOWN_PREVIEW_MAX_PCT, value))
}

function startMarkdownSplitResize(e: PointerEvent) {
  e.preventDefault()
  stopMarkdownSplitResize?.()

  const container = markdownDiffRef.value
  if (!container) return

  const startY = e.clientY
  const startH = container.getBoundingClientRect().height
  const startPct = previewPct.value
  if (startH <= 0) return

  const onMove = (ev: PointerEvent) => {
    ev.preventDefault()
    const delta = ev.clientY - startY
    previewPct.value = clampMarkdownPreviewPct(startPct + (delta / startH) * 100)
  }
  const stopResize = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', stopResize)
    window.removeEventListener('pointercancel', stopResize)
    window.removeEventListener('blur', stopResize)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem(MARKDOWN_PREVIEW_SPLIT_KEY, String(previewPct.value))
    isMarkdownSplitResizing.value = false
    stopMarkdownSplitResize = null
  }

  if (e.currentTarget instanceof HTMLElement && typeof e.currentTarget.setPointerCapture === 'function') {
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  isMarkdownSplitResizing.value = true
  stopMarkdownSplitResize = stopResize
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('pointercancel', stopResize)
  window.addEventListener('blur', stopResize)
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}

async function onPreviewClick(e: MouseEvent) {
  const target = e.target instanceof Element
    ? e.target.closest<HTMLAnchorElement>('a[data-markdown-link="external"]')
    : null
  if (!target) return

  e.preventDefault()
  if (!isSafeExternalMarkdownUrl(target.href)) return
  try {
    await openUrl(target.href)
  } catch (err) {
    console.error('[MarkdownDiff] open link failed', err)
  }
}

function goNextChange() {
  diffRef.value?.goNextChange()
}

function goPrevChange() {
  diffRef.value?.goPrevChange()
}

function getScrollAnchor(): DiffScrollAnchor | null {
  return diffRef.value?.getScrollAnchor() ?? null
}

function scrollToLine(anchor: DiffScrollAnchor) {
  diffRef.value?.scrollToLine(anchor)
}

defineExpose({ goNextChange, goPrevChange, getScrollAnchor, scrollToLine })
</script>

<template>
  <div ref="markdownDiffRef" class="markdown-diff">
    <div class="markdown-preview-grid" :style="{ flex: `${previewPct} 0 0%` }">
      <section class="markdown-pane">
        <div class="pane-header">{{ t('diff.image.oldSide') }}</div>
        <div class="pane-body" @click="onPreviewClick">
          <div v-if="oldSide.loading" class="pane-state">{{ t('diff.empty.loading') }}</div>
          <div v-else-if="!oldSide.present" class="pane-state empty">{{ t('diff.image.added') }}</div>
          <div v-else-if="oldSide.text == null" class="pane-state">{{ t('diff.markdown.previewUnavailable') }}</div>
          <article v-else class="markdown-content" v-html="oldPreviewHtml" />
        </div>
      </section>

      <section class="markdown-pane">
        <div class="pane-header">{{ t('diff.image.newSide') }}</div>
        <div class="pane-body" @click="onPreviewClick">
          <div v-if="newSide.loading" class="pane-state">{{ t('diff.empty.loading') }}</div>
          <div v-else-if="!newSide.present" class="pane-state empty">{{ t('diff.image.deleted') }}</div>
          <div v-else-if="newSide.text == null" class="pane-state">{{ t('diff.markdown.previewUnavailable') }}</div>
          <article v-else class="markdown-content" v-html="newPreviewHtml" />
        </div>
      </section>
    </div>

    <div class="markdown-split-resize" @pointerdown="startMarkdownSplitResize" />

    <div
      v-if="isMarkdownSplitResizing"
      class="markdown-split-overlay"
      @pointermove.prevent
      @pointerup.prevent="stopMarkdownSplitResize?.()"
      @pointercancel.prevent="stopMarkdownSplitResize?.()"
    />

    <div class="markdown-source-diff" :style="{ flex: `${100 - previewPct} 0 0%` }">
      <SideBySideDiff
        v-if="uiStore.diffLayoutMode === 'side-by-side'"
        ref="diffRef"
        :diff="diff"
        :syntax-lang="syntaxLang"
        :syntax-lang-for-line="syntaxLangForLine"
        :full-file-content="fullFileContent"
        :group-by-hunk="uiStore.diffGroupByHunk"
        :scroll-reset-key="scrollResetKey"
        :hunk-action-label="hunkActionLabel"
        :hunk-discard-label="hunkDiscardLabel"
        @hunk-action="emit('hunk-action', $event)"
        @hunk-discard="emit('hunk-discard', $event)"
      />
      <InlineDiff
        v-else
        ref="diffRef"
        :diff="diff"
        :group-by-hunk="uiStore.diffGroupByHunk"
        :syntax-lang="syntaxLang"
        :syntax-lang-for-line="syntaxLangForLine"
        :full-file-content="fullFileContent"
        :scroll-reset-key="scrollResetKey"
        :hunk-action-label="hunkActionLabel"
        :hunk-discard-label="hunkDiscardLabel"
        @hunk-action="emit('hunk-action', $event)"
        @hunk-discard="emit('hunk-discard', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.markdown-diff {
  display: flex;
  flex-direction: column;
  position: relative;
  height: 100%;
  min-height: 0;
  background: var(--bg-primary);
}

.markdown-preview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  flex-shrink: 0;
  min-height: 0;
  overflow: hidden;
}

.markdown-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border);
}

.markdown-pane:last-child {
  border-right: none;
}

.pane-header {
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

.pane-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}

.pane-state.empty {
  color: var(--text-muted);
  font-style: italic;
}

.markdown-content {
  padding: 16px 18px 32px;
  color: var(--text-primary);
  font-size: var(--font-base);
  line-height: 1.6;
  user-select: text;
  overflow-wrap: anywhere;
}

.markdown-content :deep(*) {
  user-select: text;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin: 1.1em 0 0.45em;
  line-height: 1.25;
  color: var(--text-primary);
}

.markdown-content :deep(h1:first-child),
.markdown-content :deep(h2:first-child),
.markdown-content :deep(h3:first-child),
.markdown-content :deep(h4:first-child),
.markdown-content :deep(p:first-child) {
  margin-top: 0;
}

.markdown-content :deep(p),
.markdown-content :deep(ul),
.markdown-content :deep(ol),
.markdown-content :deep(blockquote),
.markdown-content :deep(pre),
.markdown-content :deep(table) {
  margin: 0.8em 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 1.5em;
}

.markdown-content :deep(blockquote) {
  padding-left: 12px;
  color: var(--text-secondary);
  border-left: 3px solid var(--border);
}

.markdown-content :deep(code) {
  font-family: var(--code-font-family);
  font-size: var(--code-font-size);
  background: var(--bg-secondary);
  border-radius: 4px;
  padding: 1px 4px;
}

.markdown-content :deep(pre) {
  overflow: auto;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.markdown-content :deep(pre code) {
  display: block;
  padding: 0;
  background: transparent;
  border-radius: 0;
  white-space: pre;
}

.markdown-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  display: block;
  overflow: auto;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  padding: 5px 8px;
  border: 1px solid var(--border);
}

.markdown-content :deep(th) {
  background: var(--bg-secondary);
}

.markdown-content :deep(a) {
  color: var(--accent-blue);
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(.markdown-link--disabled) {
  color: var(--text-secondary);
}

.markdown-content :deep(.markdown-image-placeholder) {
  display: inline-block;
  padding: 2px 6px;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 4px;
  font-family: var(--code-font-family);
  font-size: var(--font-sm);
}

.markdown-split-resize {
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

.markdown-split-resize:hover,
.markdown-split-resize:active {
  background: rgba(138, 173, 244, 0.3);
}

.markdown-split-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  cursor: row-resize;
  background: transparent;
}

.markdown-source-diff {
  min-height: 0;
  overflow: hidden;
}
</style>
