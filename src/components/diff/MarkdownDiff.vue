<script setup lang="ts">
import { type ComponentPublicInstance, computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileDiff } from '@/types/git'
import { useUiStore } from '@/stores/ui'
import { useGitCommands } from '@/composables/useGitCommands'
import { loadMarkdownContent, markdownSource, type MarkdownContent, type MarkdownWip } from '@/lib/markdownContent'
import MarkdownPreview from './MarkdownPreview.vue'

const props = defineProps<{ diff: FileDiff; repoId: string; wip: MarkdownWip; identityKey?: string | null; loading?: boolean }>()
const { t } = useI18n()
const ui = useUiStore()
const git = useGitCommands()
const oldContent = ref<MarkdownContent | null>(null)
const newContent = ref<MarkdownContent | null>(null)
const pending = ref(false)
const remoteImages = ref(false)
const syncScroll = ref(true)
const oldPane = ref<HTMLElement | null>(null)
const newPane = ref<HTMLElement | null>(null)
const compare = computed(() => ui.markdownMode === 'compare')
const sides = computed(() => compare.value ? ['old', 'new'] as const : ['new'] as const)
const oldLabel = computed(() => t(props.wip ? (props.wip.staged ? 'diff.markdown.head' : 'diff.markdown.index') : 'diff.markdown.before'))
const newLabel = computed(() => t(props.wip ? (props.wip.staged ? 'diff.markdown.indexAfter' : 'diff.markdown.worktree') : 'diff.markdown.after'))
let sequence = 0
let cache: Partial<Record<'old' | 'new', Promise<MarkdownContent>>> = {}
let scrollFrame = 0
let scrollSource: 'old' | 'new' | null = null
let scrollIdentity = ''
let scrollPositions = { old: 0, new: 0 }

watch(() => [props.diff, props.repoId, props.wip?.staged, props.wip?.status, props.identityKey] as const, () => {
  cache = {}
}, { flush: 'sync' })
watch(() => [props.diff, props.repoId, props.wip?.staged, props.wip?.status, props.identityKey, props.loading, compare.value] as const, () => { void load() }, { immediate: true })
watch(() => props.identityKey, () => {
  remoteImages.value = false
  oldPane.value?.scrollTo({ top: 0 })
  newPane.value?.scrollTo({ top: 0 })
})
onBeforeUnmount(() => { sequence++; if (scrollFrame) cancelAnimationFrame(scrollFrame) })

async function load() {
  const seq = ++sequence
  const identity = JSON.stringify([props.repoId, props.identityKey, props.diff.old_path, props.diff.new_path, props.wip?.staged])
  if (identity !== scrollIdentity) {
    scrollIdentity = identity
    scrollPositions = { old: 0, new: 0 }
  } else {
    scrollPositions = { old: oldPane.value?.scrollTop ?? scrollPositions.old, new: newPane.value?.scrollTop ?? scrollPositions.new }
  }
  oldContent.value = null
  newContent.value = null
  pending.value = true
  if (props.loading) return
  const diff = props.diff
  const repoId = props.repoId
  const wip = props.wip ? { ...props.wip } : null
  const readers = {
    blob: (oid: string) => git.getBlobBytes(repoId, oid, true),
    worktree: (path: string) => git.readWorktreeFile(repoId, path, true),
  }
  const read = (side: 'old' | 'new') => cache[side] ??= loadMarkdownContent(markdownSource(diff, side, wip), diff.encoding, readers)
  const [old, current] = await Promise.all([compare.value ? read('old') : null, read('new')])
  if (seq !== sequence) return
  oldContent.value = old
  newContent.value = current
  pending.value = false
  await nextTick()
  if (seq !== sequence) return
  if (oldPane.value) oldPane.value.scrollTop = scrollPositions.old
  if (newPane.value) newPane.value.scrollTop = scrollPositions.new
}
function retry() { cache = {}; void load() }
function setPane(side: 'old' | 'new', element: Element | ComponentPublicInstance | null) {
  const pane = element instanceof HTMLElement ? element : null
  if (side === 'old') oldPane.value = pane
  else newPane.value = pane
}
function text(side: 'old' | 'new') {
  const value = content(side)
  return value?.kind === 'ready' ? value.text : ''
}
function content(side: 'old' | 'new') { return side === 'old' ? oldContent.value : newContent.value }
function stateLabel(side: 'old' | 'new') {
  switch (content(side)?.kind) {
    case 'missing': return t(side === 'old' ? 'diff.markdown.added' : 'diff.markdown.deleted')
    case 'too-large': return t('diff.markdown.tooLarge')
    default: return t('diff.markdown.loadError')
  }
}
function onScroll(side: 'old' | 'new') {
  if (!compare.value || !syncScroll.value || (scrollSource && scrollSource !== side)) return
  scrollSource = side
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    const source = side === 'old' ? oldPane.value : newPane.value
    const target = side === 'old' ? newPane.value : oldPane.value
    if (source && target) {
      const height = source.scrollHeight - source.clientHeight
      target.scrollTop = height > 0 ? source.scrollTop / height * (target.scrollHeight - target.clientHeight) : 0
    }
    scrollFrame = requestAnimationFrame(() => { scrollSource = null; scrollFrame = 0 })
  })
}
</script>

<template>
  <section class="markdown-diff" :aria-label="t('diff.markdown.preview')">
    <div class="markdown-options">
      <label><input type="checkbox" :checked="ui.markdownMermaid" @change="ui.toggleMarkdownMermaid()" />{{ t('diff.markdown.mermaid') }}</label>
      <label><input v-model="remoteImages" type="checkbox" />{{ t('diff.markdown.remoteImages') }}</label>
      <label v-if="compare"><input v-model="syncScroll" type="checkbox" />{{ t('diff.markdown.syncScroll') }}</label>
      <button type="button" @click="retry">{{ t('diff.markdown.refresh') }}</button>
    </div>
    <div v-if="pending || loading" class="markdown-state" role="status">{{ t('diff.empty.loading') }}</div>
    <div v-else class="markdown-panes" :class="{ 'markdown-panes--compare': compare }">
      <section v-for="side in sides" :key="side" class="markdown-pane" :aria-label="side === 'old' ? oldLabel : newLabel">
        <div class="markdown-side-label" :class="side">{{ side === 'old' ? oldLabel : newLabel }}</div>
        <div :ref="(element) => setPane(side, element)"
          class="markdown-scroll" tabindex="0" @scroll="onScroll(side)">
          <MarkdownPreview v-if="content(side)?.kind === 'ready'" :text="text(side)"
            :mermaid-enabled="ui.markdownMermaid" :highlight="ui.diffHighlightEnabled" :remote-images="remoteImages" />
          <div v-else class="markdown-state" role="status">
            <p>{{ stateLabel(side) }}</p>
            <button v-if="content(side)?.kind === 'error'" type="button" @click="retry">{{ t('diff.markdown.retry') }}</button>
            <button type="button" @click="ui.setMarkdownMode('source')">{{ t('diff.markdown.source') }}</button>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.markdown-diff { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--bg-primary); }
.markdown-options { display: flex; flex-wrap: wrap; gap: 12px; padding: 7px 12px; border-bottom: 1px solid var(--border); font-size: var(--font-sm); color: var(--text-secondary); }
.markdown-options label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.markdown-options button { margin-left: auto; }
button { font: inherit; padding: 2px 8px; border: 1px solid var(--border); border-radius: 4px; color: var(--text-secondary); background: var(--bg-surface); cursor: pointer; }
button:hover { color: var(--accent-blue); }
.markdown-panes { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.markdown-panes--compare { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.markdown-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.markdown-pane + .markdown-pane { border-left: 1px solid var(--border); }
.markdown-scroll { flex: 1; overflow: auto; min-height: 0; scrollbar-gutter: stable; }
.markdown-side-label { padding: 5px 12px; color: var(--text-secondary); background: var(--bg-secondary); border-bottom: 1px solid var(--border); font-size: var(--font-sm); }
.markdown-side-label.old { border-left: 3px solid var(--accent-red); }
.markdown-side-label.new { border-left: 3px solid var(--accent-green); }
.markdown-state { padding: 30px 18px; text-align: center; color: var(--text-muted); font-size: var(--font-base); }
.markdown-state p { margin-bottom: 12px; }
.markdown-state button { margin: 4px; }
</style>
