<script setup lang="ts">
import { ref, computed } from 'vue'
import type { FileDiff } from '@/types/git'
import SideBySideDiff from './SideBySideDiff.vue'
import InlineDiff from './InlineDiff.vue'
import ImageDiff from './ImageDiff.vue'
import ConflictView from './ConflictView.vue'
import DiffToolbar from './DiffToolbar.vue'
import { EXT_TO_LANG } from '@/lib/highlight'
import { detectPreviewKind } from '@/lib/preview'
import { useUiStore } from '@/stores/ui'
import { useRevertHunk } from '@/composables/diff/useRevertHunk'

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

const syntaxLang = computed<string | null>(() => {
  if (!uiStore.diffHighlightEnabled || !props.diff) return null
  const filePath = props.diff.new_path ?? props.diff.old_path ?? ''
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANG[ext] ?? null
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

// 子 diff 组件的引用（切换 viewMode 时 v-if 切换实例，ref 自动更新）
const diffRef = ref<{
  goNextChange: () => void
  goPrevChange: () => void
} | null>(null)

function onNextChange() {
  diffRef.value?.goNextChange()
}
function onPrevChange() {
  diffRef.value?.goPrevChange()
}

const { allowRevert, revertHunk } = useRevertHunk({
  repoId: () => props.repoId,
  diff: () => props.diff,
  wip: () => props.wip ?? null,
})
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
        v-else-if="uiStore.diffViewMode === 'side-by-side'"
        ref="diffRef"
        :diff="diff"
        :loading="loading"
        :syntax-lang="syntaxLang"
        :allow-revert="allowRevert"
        @revert-hunk="revertHunk"
      />
      <InlineDiff
        v-else
        ref="diffRef"
        :diff="diff"
        :loading="loading"
        :group-by-hunk="uiStore.diffViewMode === 'by-hunk'"
        :syntax-lang="syntaxLang"
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
