<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { go } from '@codemirror/lang-go'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { StreamLanguage } from '@codemirror/language'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
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

function getLanguageExtension(diff: FileDiff | null): Extension {
  if (!highlightEnabled.value || !diff) return []
  const filePath = diff.new_path ?? diff.old_path ?? ''
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'js':   return javascript()
    case 'ts':   return javascript({ typescript: true })
    case 'jsx':  return javascript({ jsx: true })
    case 'tsx':  return javascript({ typescript: true, jsx: true })
    case 'py':   return python()
    case 'rs':   return rust()
    case 'go':   return go()
    case 'json': return json()
    case 'css':  return css()
    case 'html':
    case 'htm':  return html()
    case 'md':   return markdown()
    case 'java': return java()
    case 'c':
    case 'h':
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':  return cpp()
    case 'xml':
    case 'vue':
    case 'svelte': return xml()
    case 'sql':  return sql()
    case 'yaml':
    case 'yml':  return StreamLanguage.define(yaml)
    case 'sh':
    case 'bash':
    case 'zsh':  return StreamLanguage.define(shell)
    default:     return []
  }
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
        langCompartment.of(getLanguageExtension(props.diff)),
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

function toggleHighlight() {
  highlightEnabled.value = !highlightEnabled.value
  localStorage.setItem(HIGHLIGHT_KEY, String(highlightEnabled.value))
  if (view) {
    view.dispatch({
      effects: langCompartment.reconfigure(getLanguageExtension(props.diff))
    })
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
