<script setup lang="ts">
import { ref, computed, nextTick, watch, useSlots } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileDiff, FileStatusKind } from '@/types/git'
import SideBySideDiff from './SideBySideDiff.vue'
import InlineDiff from './InlineDiff.vue'
import ImageDiff from './ImageDiff.vue'
import DocumentDiff from './DocumentDiff.vue'
import ConflictView from './ConflictView.vue'
import DiffToolbar from './DiffToolbar.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import { EXT_TO_LANG, type DiffSide, type SyntaxLangResolver } from '@/lib/highlight'
import { createVueSfcLineLangMap, isVuePath, type VueSfcLineLangMap } from '@/lib/vueSfcHighlight'
import { detectPreviewKind } from '@/lib/preview'
import { useUiStore } from '@/stores/ui'
import { useRevertHunk } from '@/composables/diff/useRevertHunk'
import { useWipHunkAction } from '@/composables/diff/useWipHunkAction'
import { useGitCommands } from '@/composables/useGitCommands'
import type { FullFileContent } from '@/lib/fullFileDiff'

const props = defineProps<{
  diff: FileDiff | null
  loading?: boolean
  repoId?: string
  /** 当前 diff 的 UI 身份；变化时视为切换到另一个文件/提交上下文。 */
  diffIdentityKey?: string | null
  /** WIP 场景传入；提交详情传 null 或不传 */
  wip?: { staged: boolean; status?: FileStatusKind } | null
  /** 当前选中文件是冲突文件时的路径。非空则切换到冲突解决视图 */
  conflictFilePath?: string | null
}>()

const emit = defineEmits<{ close: [] }>()
const slots = useSlots()

const { t } = useI18n()
const uiStore = useUiStore()
const { getBlobBytes, readWorktreeFile } = useGitCommands()

const syntaxLang = computed<string | null>(() => {
  if (!uiStore.diffHighlightEnabled || !props.diff) return null
  const filePath = props.diff.new_path ?? props.diff.old_path ?? ''
  if (isVuePath(filePath)) return null
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANG[ext] ?? null
})

const vueLangMaps = ref<{ old: VueSfcLineLangMap | null; new: VueSfcLineLangMap | null }>({
  old: null,
  new: null,
})
const fullFileContent = ref<FullFileContent | null>(null)

const isVueDiff = computed(() => isVuePath(props.diff?.new_path ?? props.diff?.old_path))

const syntaxLangForLine = computed<SyntaxLangResolver | null>(() => {
  if (!uiStore.diffHighlightEnabled || !isVueDiff.value) return null
  return (side: DiffSide, lineNo: number | null | undefined) => {
    const map = side === 'old' ? vueLangMaps.value.old : vueLangMaps.value.new
    return map?.langForLine(lineNo) ?? 'html'
  }
})

const previewKind = computed(() => {
  if (!props.diff) return null
  return detectPreviewKind(props.diff.new_path ?? props.diff.old_path)
})

// SVG 可在图片预览和文本 diff 之间切换；位图强制图片视图
const svgTextMode = ref(false)

const isImageView = computed(() => {
  if (previewKind.value === 'raster') return true
  if (previewKind.value === 'svg' && !svgTextMode.value) return true
  return false
})

const documentKind = computed<'pdf' | 'docx' | 'pptx' | null>(() => {
  if (previewKind.value === 'pdf' || previewKind.value === 'docx' || previewKind.value === 'pptx') {
    return previewKind.value
  }
  return null
})

const fileModeChange = computed(() => {
  const diff = props.diff
  if (!diff || diff.old_file_mode == null || diff.new_file_mode == null) return null
  if (diff.old_file_mode === diff.new_file_mode) return null
  const oldTypeBits = fileTypeBits(diff.old_file_mode)
  const newTypeBits = fileTypeBits(diff.new_file_mode)
  return {
    kind: oldTypeBits === newTypeBits ? 'mode' : 'type',
    oldType: fileModeTypeLabel(diff.old_file_mode),
    newType: fileModeTypeLabel(diff.new_file_mode),
    oldMode: formatFileMode(diff.old_file_mode),
    newMode: formatFileMode(diff.new_file_mode),
  }
})

interface DiffScrollAnchor {
  oldLineNo?: number
  newLineNo?: number
}

// 子 diff 组件的引用（切换 viewMode 时 v-if 切换实例，ref 自动更新）
const diffRef = ref<{
  goNextChange: () => void
  goPrevChange: () => void
  hasChangeTargets: () => boolean
  getScrollAnchor: () => DiffScrollAnchor | null
  scrollToLine: (anchor: DiffScrollAnchor) => void
} | null>(null)
const diffViewEl = ref<HTMLElement | null>(null)
const pendingScrollAnchor = ref<DiffScrollAnchor | null>(null)
const currentChangeIdx = ref(-1)
const changeCount = ref(0)
const activeDiffIdentityKey = computed(() => props.diffIdentityKey ?? fallbackDiffIdentityKey(props.diff))

function onNextChange() {
  diffRef.value?.goNextChange()
}
function onPrevChange() {
  diffRef.value?.goPrevChange()
}

function onCurrentChangeUpdate(index: number) {
  currentChangeIdx.value = normalizeChangeIndex(index, changeCount.value)
}

function onChangeCountUpdate(count: number) {
  changeCount.value = Math.max(0, count)
  currentChangeIdx.value = normalizeChangeIndex(currentChangeIdx.value, changeCount.value)
}

function resetCurrentChange() {
  currentChangeIdx.value = -1
  changeCount.value = 0
}

function normalizeChangeIndex(index: number, count: number): number {
  if (count <= 0) return -1
  if (index < 0) return -1
  return index < count ? index : -1
}

function onDiffBodyClick(event: MouseEvent) {
  if (!diffRef.value || isInteractiveTarget(event.target)) return
  diffViewEl.value?.focus({ preventScroll: true })
}

function onDiffViewKeydown(event: KeyboardEvent) {
  if (!diffRef.value || isInteractiveTarget(event.target) || hasModifierKey(event)) return
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !diffRef.value.hasChangeTargets()) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    event.stopPropagation()
    onNextChange()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    onPrevChange()
  }
}

function hasModifierKey(event: KeyboardEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      'button, input, textarea, select, option, a[href], [role="button"], [contenteditable]:not([contenteditable="false"])',
    ),
  )
}

watch(
  () => [uiStore.diffLayoutMode, uiStore.diffGroupByHunk] as const,
  () => {
    const anchor = diffRef.value?.getScrollAnchor()
    if (!anchor) return
    pendingScrollAnchor.value = anchor
    void restorePendingScrollAnchor()
  },
)

watch(activeDiffIdentityKey, (next, prev) => {
  if (next === prev) return
  pendingScrollAnchor.value = null
  resetCurrentChange()
})

watch(
  () => props.diff,
  (next, prev) => {
    if (next === prev) return
    resetCurrentChange()
  },
)

watch(
  () => fullFileContent.value,
  () => {
    if (!pendingScrollAnchor.value) return
    void restorePendingScrollAnchor(true)
  },
)

async function restorePendingScrollAnchor(forceClear = false) {
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const anchor = pendingScrollAnchor.value
  if (!anchor) return
  diffRef.value?.scrollToLine(anchor)
  if (forceClear || uiStore.diffGroupByHunk || fullFileContent.value) {
    pendingScrollAnchor.value = null
  }
}

const { allowRevert, revertHunk } = useRevertHunk({
  repoId: () => props.repoId,
  diff: () => props.diff,
  wip: () => props.wip ?? null,
})
const showHunkRevert = computed(() => allowRevert.value && uiStore.diffGroupByHunk)
const { action: wipHunkAction, canDiscardHunk, applyWipHunk, discardWipHunk } = useWipHunkAction({
  repoId: () => props.repoId,
  diff: () => props.diff,
  wip: () => props.wip ?? null,
})
const hunkActionLabel = computed(() => {
  if (!uiStore.diffGroupByHunk) return null
  if (showHunkRevert.value) return t('diff.hunk.rollback')
  if (wipHunkAction.value === 'stage') return t('diff.hunk.stage')
  if (wipHunkAction.value === 'unstage') return t('diff.hunk.unstage')
  return null
})
const hunkDiscardLabel = computed(() => {
  if (!uiStore.diffGroupByHunk || showHunkRevert.value || !canDiscardHunk.value) return null
  return t('diff.hunk.discard')
})

const discardHunkConfirmOpen = ref(false)
const discardHunkLoading = ref(false)
const pendingDiscardHunkIndex = ref<number | null>(null)

async function onHunkAction(hunkIndex: number) {
  if (showHunkRevert.value) {
    await revertHunk(hunkIndex)
    return
  }
  await applyWipHunk(hunkIndex)
}

function onHunkDiscard(hunkIndex: number) {
  pendingDiscardHunkIndex.value = hunkIndex
  discardHunkConfirmOpen.value = true
}

async function onConfirmDiscardHunk() {
  const hunkIndex = pendingDiscardHunkIndex.value
  if (hunkIndex == null) return
  discardHunkLoading.value = true
  try {
    await discardWipHunk(hunkIndex)
    discardHunkConfirmOpen.value = false
    pendingDiscardHunkIndex.value = null
  } finally {
    discardHunkLoading.value = false
  }
}

function onCancelDiscardHunk() {
  if (discardHunkLoading.value) return
  discardHunkConfirmOpen.value = false
  pendingDiscardHunkIndex.value = null
}

let vueLoadSeq = 0
watch(
  () => [
    props.diff,
    props.repoId,
    props.diff?.old_blob_oid,
    props.diff?.new_blob_oid,
    props.diff?.old_path,
    props.diff?.new_path,
    props.wip?.staged,
    uiStore.diffHighlightEnabled,
  ] as const,
  async () => {
    const seq = ++vueLoadSeq
    vueLangMaps.value = { old: null, new: null }
    if (!uiStore.diffHighlightEnabled || !props.diff || !props.repoId || !isVueDiff.value) return

    const [oldText, newText] = await Promise.all([
      loadSideText('old', props.diff),
      loadSideText('new', props.diff),
    ])
    if (seq !== vueLoadSeq) return
    vueLangMaps.value = {
      old: createVueSfcLineLangMap(oldText),
      new: createVueSfcLineLangMap(newText),
    }
  },
  { immediate: true },
)

let fullFileLoadSeq = 0
watch(
  () => [
    props.diff,
    props.repoId,
    props.diff?.old_blob_oid,
    props.diff?.new_blob_oid,
    props.diff?.old_path,
    props.diff?.new_path,
    props.diff?.encoding,
    props.wip?.staged,
    uiStore.diffLayoutMode,
    uiStore.diffGroupByHunk,
    svgTextMode.value,
  ] as const,
  async () => {
    const seq = ++fullFileLoadSeq
    fullFileContent.value = null
    if (
      !props.diff ||
      !props.repoId ||
      props.diff.is_binary ||
      props.diff.hunks.length === 0 ||
      isImageView.value ||
      uiStore.diffGroupByHunk
    ) {
      return
    }

    const content = await loadFullFileContent(props.diff)
    if (seq !== fullFileLoadSeq) return
    fullFileContent.value = content
  },
  { immediate: true },
)

async function loadFullFileContent(diff: FileDiff): Promise<FullFileContent | null> {
  const [oldText, newText] = await Promise.all([
    loadSideText('old', diff),
    loadSideText('new', diff),
  ])
  if (oldText == null || newText == null) return null
  return { oldText, newText }
}

async function loadSideText(side: DiffSide, diff: FileDiff): Promise<string | null> {
  try {
    if (side === 'old') {
      if (!diff.old_blob_oid) return ''
      const blob = await getBlobBytes(props.repoId!, diff.old_blob_oid, true)
      return blob.truncated ? null : decodeBase64Text(blob.bytes_base64, diff.encoding)
    }

    if (props.wip && !props.wip.staged && diff.new_path && diffHasNewSide(diff)) {
      const blob = await readWorktreeFile(props.repoId!, diff.new_path, true)
      return blob.truncated ? null : decodeBase64Text(blob.bytes_base64, diff.encoding)
    }
    if (!diff.new_blob_oid) return ''
    const blob = await getBlobBytes(props.repoId!, diff.new_blob_oid, true)
    return blob.truncated ? null : decodeBase64Text(blob.bytes_base64, diff.encoding)
  } catch {
    return null
  }
}

function diffHasNewSide(diff: FileDiff): boolean {
  if (diff.new_blob_oid) return true
  return diff.hunks.some((hunk) => hunk.new_lines > 0)
}

function decodeBase64Text(base64: string, encoding: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  try {
    return new TextDecoder(normalizeTextDecoderLabel(encoding)).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

function normalizeTextDecoderLabel(encoding: string): string {
  if (encoding.toUpperCase() === 'UTF-8 BOM') return 'utf-8'
  return encoding
}

function fileModeTypeLabel(mode: number): string {
  switch (fileTypeBits(mode)) {
    case 0o040000:
      return t('diff.fileType.directory')
    case 0o100000:
      return t('diff.fileType.file')
    case 0o120000:
      return t('diff.fileType.symlink')
    case 0o160000:
      return t('diff.fileType.gitlink')
    default:
      return t('diff.fileType.unknown')
  }
}

function fileTypeBits(mode: number): number {
  return mode & 0o170000
}

function formatFileMode(mode: number): string {
  return mode.toString(8).padStart(6, '0')
}

function fallbackDiffIdentityKey(diff: FileDiff | null): string | null {
  if (!diff) return null
  return [
    props.repoId ?? '',
    props.wip ? (props.wip.staged ? 'wip:staged' : 'wip:unstaged') : 'commit',
    diff.old_path ?? '',
    diff.new_path ?? '',
  ].join('\u0000')
}
</script>

<template>
  <!-- 冲突文件：专用双栏解决视图（自带 toolbar） -->
  <ConflictView
    v-if="conflictFilePath"
    :file-path="conflictFilePath"
    @close="emit('close')"
  />

  <div
    v-else
    ref="diffViewEl"
    class="diff-view"
    tabindex="-1"
    @keydown="onDiffViewKeydown"
  >
    <DiffToolbar
      v-if="diff"
      v-model:svg-text-mode="svgTextMode"
      :diff="diff"
      :is-image-view="isImageView"
      :preview-kind="previewKind"
      :current-change-idx="currentChangeIdx"
      :change-count="changeCount"
      :has-leading="Boolean(slots['toolbar-leading'])"
      @prev-change="onPrevChange"
      @next-change="onNextChange"
      @close="emit('close')"
    >
      <template #leading>
        <slot name="toolbar-leading" />
      </template>
    </DiffToolbar>

    <!-- Diff body -->
    <div class="diff-body" @click="onDiffBodyClick">
      <DocumentDiff
        v-if="documentKind && diff && repoId"
        :diff="diff"
        :repo-id="repoId"
        :document-kind="documentKind"
        :wip="wip ?? null"
      />
      <ImageDiff
        v-else-if="isImageView && diff && repoId"
        :diff="diff"
        :repo-id="repoId"
        :wip="wip ?? null"
      />
      <div
        v-else-if="diff && diff.hunks.length === 0 && fileModeChange"
        class="metadata-state"
      >
        <div class="metadata-title">
          <template v-if="fileModeChange.kind === 'type'">
            {{
              t('diff.empty.typeChanged', {
                oldType: fileModeChange.oldType,
                newType: fileModeChange.newType,
              })
            }}
          </template>
          <template v-else>
            {{ t('diff.empty.modeChanged') }}
          </template>
        </div>
        <div class="metadata-detail">
          {{ fileModeChange.oldMode }} -> {{ fileModeChange.newMode }}
        </div>
      </div>
      <SideBySideDiff
        v-else-if="uiStore.diffLayoutMode === 'side-by-side'"
        ref="diffRef"
        :diff="diff"
        :loading="loading"
        :syntax-lang="syntaxLang"
        :syntax-lang-for-line="syntaxLangForLine"
        :full-file-content="fullFileContent"
        :group-by-hunk="uiStore.diffGroupByHunk"
        :scroll-reset-key="activeDiffIdentityKey"
        :current-change-idx="currentChangeIdx"
        :hunk-action-label="hunkActionLabel"
        :hunk-discard-label="hunkDiscardLabel"
        @update-current-change="onCurrentChangeUpdate"
        @change-count="onChangeCountUpdate"
        @hunk-action="onHunkAction"
        @hunk-discard="onHunkDiscard"
      />
      <InlineDiff
        v-else
        ref="diffRef"
        :diff="diff"
        :loading="loading"
        :group-by-hunk="uiStore.diffGroupByHunk"
        :syntax-lang="syntaxLang"
        :syntax-lang-for-line="syntaxLangForLine"
        :full-file-content="fullFileContent"
        :scroll-reset-key="activeDiffIdentityKey"
        :current-change-idx="currentChangeIdx"
        :hunk-action-label="hunkActionLabel"
        :hunk-discard-label="hunkDiscardLabel"
        @update-current-change="onCurrentChangeUpdate"
        @change-count="onChangeCountUpdate"
        @hunk-action="onHunkAction"
        @hunk-discard="onHunkDiscard"
      />
    </div>

    <ConfirmDialog
      :visible="discardHunkConfirmOpen"
      :title="t('diff.hunk.confirmDiscardTitle')"
      :message="t('diff.hunk.confirmDiscardMessage')"
      :confirm-label="t('diff.hunk.discard')"
      :loading-label="t('common.loading')"
      :loading="discardHunkLoading"
      :danger="true"
      @confirm="onConfirmDiscardHunk"
      @cancel="onCancelDiscardHunk"
    />
  </div>
</template>

<style scoped>
.diff-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  outline: none; /* remove focus outline for tabindex=-1 */
}

.diff-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.metadata-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 13px;
}

.metadata-title {
  color: var(--text-primary);
  font-weight: 500;
}

.metadata-detail {
  font-family: var(--code-font-family, 'SF Mono', monospace);
  font-size: 12px;
}
</style>
