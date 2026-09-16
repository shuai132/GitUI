<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { EXT_TO_LANG, highlightLine } from '@/lib/highlight'
import { MAX_MERMAID_CHARS, renderMermaid } from '@/lib/mermaid'
import type { MarkdownCode } from '@/lib/markdown'

const props = defineProps<{ code: MarkdownCode; mermaidEnabled: boolean; highlight: boolean }>()
const { t } = useI18n()
const settings = useSettingsStore()
const { copyText } = useClipboardFeedback(t)
const root = ref<HTMLElement | null>(null)
const visible = ref(false)
const sourceMode = ref(false)
const zoom = ref(1)
const image = ref<string | null>(null)
const error = ref(false)
const loading = ref(false)
const isMermaid = computed(() => props.code.language === 'mermaid')
const diagramMode = computed(() => isMermaid.value && props.mermaidEnabled && !sourceMode.value)
const tooLarge = computed(() => props.code.text.length > MAX_MERMAID_CHARS)
const codeHtml = computed(() => highlightLine(props.code.text,
  props.highlight && !isMermaid.value ? EXT_TO_LANG[props.code.language] ?? props.code.language : null))
let observer: IntersectionObserver | null = null
let sequence = 0
let disposed = false

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') { visible.value = true; return }
  observer = new IntersectionObserver((entries) => {
    visible.value = entries.some((entry) => entry.isIntersecting)
  }, { rootMargin: '200px' })
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => { disposed = true; sequence++; observer?.disconnect() })

watch(() => [props.code.text, settings.resolvedTheme] as const, () => {
  image.value = null
  error.value = false
  zoom.value = 1
}, { flush: 'sync' })
watch(() => [props.code.text, settings.resolvedTheme, diagramMode.value, visible.value] as const, async () => {
  const seq = ++sequence
  loading.value = false
  if (!diagramMode.value || !visible.value || tooLarge.value || image.value || error.value) return
  loading.value = true
  const isCurrent = () => !disposed && seq === sequence
  try {
    const result = await renderMermaid(props.code.text, settings.resolvedTheme === 'dark', isCurrent)
    if (isCurrent()) image.value = result
  } catch {
    if (isCurrent()) error.value = true
  } finally {
    if (isCurrent()) loading.value = false
  }
}, { immediate: true })

function retry() {
  error.value = false
  sourceMode.value = true
}
</script>

<template>
  <section ref="root" class="markdown-code-block">
    <div class="code-toolbar">
      <span class="code-language">{{ code.language || t('diff.markdown.code') }}</span>
      <template v-if="diagramMode && image">
        <button type="button" :aria-label="t('diff.markdown.zoomOut')" :disabled="zoom <= 0.5" @click="zoom = Math.max(0.5, zoom - 0.25)">−</button>
        <button type="button" :title="t('diff.markdown.resetZoom')" @click="zoom = 1">{{ Math.round(zoom * 100) }}%</button>
        <button type="button" :aria-label="t('diff.markdown.zoomIn')" :disabled="zoom >= 3" @click="zoom = Math.min(3, zoom + 0.25)">+</button>
      </template>
      <button v-if="isMermaid && mermaidEnabled" type="button" :aria-pressed="sourceMode" @click="sourceMode = !sourceMode">{{ sourceMode ? t('diff.markdown.showDiagram') : t('diff.markdown.showCode') }}</button>
      <button type="button" @click="copyText(code.text)">{{ t('diff.markdown.copyCode') }}</button>
    </div>
    <div v-if="diagramMode && image" class="diagram-scroll">
      <img :src="image" :alt="t('diff.markdown.diagram')" class="mermaid-image" :style="{ width: `${zoom * 100}%` }" />
    </div>
    <div v-else-if="diagramMode && !error && !tooLarge" class="diagram-state" role="status">{{ t(loading ? 'diff.empty.loading' : 'diff.markdown.diagramPending') }}</div>
    <template v-if="!diagramMode || error || (diagramMode && tooLarge)">
      <div v-if="diagramMode" class="diagram-error" role="status">
        {{ t(tooLarge ? 'diff.markdown.diagramTooLarge' : 'diff.markdown.diagramError') }}
        <button v-if="!tooLarge" type="button" @click="retry">{{ t('diff.markdown.showCode') }}</button>
      </div>
      <pre><code v-html="codeHtml" /></pre>
    </template>
  </section>
</template>

<style scoped>
.markdown-code-block { margin: 16px 0; min-width: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--bg-primary); }
.code-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 5px 8px; background: var(--bg-surface); font-size: var(--font-sm); }
.code-language { flex: 1 0 auto; white-space: nowrap; color: var(--text-muted); }
button { border: 1px solid var(--border); border-radius: 4px; background: var(--bg-secondary); color: var(--text-secondary); padding: 2px 6px; cursor: pointer; font: inherit; }
button:hover { color: var(--accent-blue); }
button:disabled { opacity: 0.4; cursor: default; }
pre { margin: 0; padding: 12px; overflow: auto; tab-size: 4; white-space: pre; font-family: var(--code-font-family); font-size: var(--code-font-size); line-height: 1.6; }
.diagram-scroll { overflow: auto; padding: 12px; }
.mermaid-image { display: block; max-width: none; min-width: 120px; margin: 0 auto; }
.diagram-state { padding: 28px; min-height: 100px; text-align: center; color: var(--text-muted); }
.diagram-error { padding: 8px 12px; color: var(--accent-yellow); font-size: var(--font-sm); }
</style>
