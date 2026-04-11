<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import type { FileDiff } from '@/types/git'

const props = defineProps<{
  diff: FileDiff | null
  loading?: boolean
}>()

const container = ref<HTMLElement | null>(null)
let view: EditorView | null = null

function buildDiffText(diff: FileDiff): string {
  if (!diff || diff.hunks.length === 0) return '(no changes)'
  const lines: string[] = []
  for (const hunk of diff.hunks) {
    lines.push(hunk.header.trimEnd())
    for (const line of hunk.lines) {
      const prefix = line.origin === '+' ? '+' : line.origin === '-' ? '-' : ' '
      lines.push(prefix + line.content.replace(/\n$/, ''))
    }
  }
  return lines.join('\n')
}

function createView(text: string) {
  if (!container.value) return
  if (view) {
    view.destroy()
    view = null
  }
  view = new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        oneDark,
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: '100%', fontSize: '12px' },
          '.cm-scroller': { fontFamily: "'SF Mono', 'Fira Code', monospace" },
          '.cm-line': { padding: '0 4px' },
        }),
      ],
    }),
    parent: container.value,
  })
}

watch(
  () => props.diff,
  async (diff) => {
    await nextTick()
    if (diff) {
      createView(buildDiffText(diff))
    } else if (view) {
      view.destroy()
      view = null
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  view?.destroy()
})
</script>

<template>
  <div class="diff-wrapper">
    <div v-if="loading" class="diff-loading">加载中...</div>
    <div v-else-if="!diff" class="diff-empty">选择文件查看变更</div>
    <div v-else-if="diff.is_binary" class="diff-empty">二进制文件</div>
    <div v-else ref="container" class="diff-container" />
  </div>
</template>

<style scoped>
.diff-wrapper {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
}

.diff-container {
  flex: 1;
  overflow: auto;
}

/* CodeMirror 动态插入的 .cm-* 元素需要可选（盖过全局 *:none）。
   用 :deep() 穿透 scoped 样式。 */
.diff-container :deep(*) {
  user-select: text;
  -webkit-user-select: text;
}

.diff-loading,
.diff-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
