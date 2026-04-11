<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import type { Extension } from '@codemirror/state'
import type { FileDiff } from '@/types/git'

const props = defineProps<{
  diff: FileDiff | null
  loading?: boolean
}>()

const container = ref<HTMLElement | null>(null)
let view: EditorView | null = null

const HIGHLIGHT_KEY = 'gitui.diff.syntax-highlight'
const highlightEnabled = ref(localStorage.getItem(HIGHLIGHT_KEY) !== 'false')
const langCompartment = new Compartment()

async function getLanguageExtension(diff: FileDiff | null): Promise<Extension> {
  if (!highlightEnabled.value || !diff) return []
  const filePath = diff.new_path ?? diff.old_path ?? ''
  const desc = LanguageDescription.matchFilename(languages, filePath)
  if (!desc) return []
  return await desc.load()
}

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

async function createView(text: string) {
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
        langCompartment.of([]),  // 先空白渲染，语言包异步加载后再注入
        EditorView.theme({
          '&': { height: '100%', fontSize: '12px' },
          '.cm-scroller': { fontFamily: "'SF Mono', 'Fira Code', monospace" },
          '.cm-line': { padding: '0 4px' },
        }),
      ],
    }),
    parent: container.value,
  })
  // 语言包懒加载（已缓存的类型几乎无延迟）
  const lang = await getLanguageExtension(props.diff)
  view?.dispatch({ effects: langCompartment.reconfigure(lang) })
}

async function toggleHighlight() {
  highlightEnabled.value = !highlightEnabled.value
  localStorage.setItem(HIGHLIGHT_KEY, String(highlightEnabled.value))
  if (view) {
    const lang = await getLanguageExtension(props.diff)
    view.dispatch({ effects: langCompartment.reconfigure(lang) })
  }
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
    <template v-else>
      <div class="diff-toolbar">
        <button
          class="highlight-toggle"
          :class="{ active: highlightEnabled }"
          @click="toggleHighlight"
          :title="highlightEnabled ? '关闭语法高亮' : '开启语法高亮'"
        >高亮</button>
      </div>
      <div ref="container" class="diff-container" />
    </template>
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

.diff-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 2px 8px;
  border-bottom: 1px solid #2a2a2a;
  background: var(--bg-secondary, #1a1a1a);
  flex-shrink: 0;
}

.highlight-toggle {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 3px;
  border: 1px solid #444;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  line-height: 1.6;
}

.highlight-toggle.active {
  color: var(--accent-blue);
  border-color: var(--accent-blue);
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
