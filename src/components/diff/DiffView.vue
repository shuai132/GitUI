<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import type { FileDiff } from '@/types/git'
import SideBySideDiff from './SideBySideDiff.vue'
import InlineDiff from './InlineDiff.vue'
import ImageDiff from './ImageDiff.vue'
import ConflictView from './ConflictView.vue'
import DiffToolbar from './DiffToolbar.vue'
import { EXT_TO_LANG, type DiffSide, type SyntaxLangResolver } from '@/lib/highlight'
import { createVueSfcLineLangMap, isVuePath, type VueSfcLineLangMap } from '@/lib/vueSfcHighlight'
import { detectPreviewKind } from '@/lib/preview'
import { useUiStore } from '@/stores/ui'
import { useRevertHunk } from '@/composables/diff/useRevertHunk'
import { useGitCommands } from '@/composables/useGitCommands'
import type { FullFileContent } from '@/lib/fullFileDiff'

const props = defineProps<{
  diff: FileDiff | null
  loading?: boolean
  repoId?: string
  /** WIP 场景传入；提交详情传 null 或不传 */
  wip?: { staged: boolean } | null
  /** 当前选中文件是冲突文件时的路径。非空则切换到冲突解决视图 */
  conflictFilePath?: string | null
}>()

const emit = defineEmits<{ close: [] }>()

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

interface DiffScrollAnchor {
  oldLineNo?: number
  newLineNo?: number
}

// 子 diff 组件的引用（切换 viewMode 时 v-if 切换实例，ref 自动更新）
const diffRef = ref<{
  goNextChange: () => void
  goPrevChange: () => void
  getScrollAnchor: () => DiffScrollAnchor | null
  scrollToLine: (anchor: DiffScrollAnchor) => void
} | null>(null)
const pendingScrollAnchor = ref<DiffScrollAnchor | null>(null)

function onNextChange() {
  diffRef.value?.goNextChange()
}
function onPrevChange() {
  diffRef.value?.goPrevChange()
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
</script>

<template>
  <!-- 冲突文件：专用双栏解决视图（自带 toolbar） -->
  <ConflictView
    v-if="conflictFilePath"
    :file-path="conflictFilePath"
    @close="emit('close')"
  />

  <div v-else class="diff-view" tabindex="-1">
    <DiffToolbar
      v-if="diff"
      v-model:svg-text-mode="svgTextMode"
      :diff="diff"
      :is-image-view="isImageView"
      :preview-kind="previewKind"
      @prev-change="onPrevChange"
      @next-change="onNextChange"
      @close="emit('close')"
    />

    <!-- Diff body -->
    <div class="diff-body">
      <ImageDiff
        v-if="isImageView && diff && repoId"
        :diff="diff"
        :repo-id="repoId"
        :wip="wip ?? null"
      />
      <SideBySideDiff
        v-else-if="uiStore.diffLayoutMode === 'side-by-side'"
        ref="diffRef"
        :diff="diff"
        :loading="loading"
        :syntax-lang="syntaxLang"
        :syntax-lang-for-line="syntaxLangForLine"
        :full-file-content="fullFileContent"
        :group-by-hunk="uiStore.diffGroupByHunk"
        :allow-revert="allowRevert"
        @revert-hunk="revertHunk"
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
        :allow-revert="allowRevert"
        @revert-hunk="revertHunk"
      />
    </div>
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
</style>
