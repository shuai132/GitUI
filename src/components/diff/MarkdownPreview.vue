<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { renderMarkdown, safeExternalUrl, type RenderedMarkdown } from '@/lib/markdown'
import MarkdownCodeBlock from './MarkdownCodeBlock.vue'

const props = defineProps<{ text: string; mermaidEnabled: boolean; highlight: boolean; remoteImages: boolean }>()
const { t } = useI18n()
const { showError, showActionError } = useGlobalToast()
const root = ref<HTMLElement | null>(null)
const prefix = `markdown-${useId().replace(/[^\w-]/g, '')}`
const slots = ref<Array<{ target: HTMLElement; index: number }>>([])
let sequence = 0
const rendered = computed<{ result: RenderedMarkdown | null; error: string | null }>(() => {
  try { return { result: renderMarkdown(props.text, prefix, props.remoteImages), error: null } }
  catch (error: unknown) { return { result: null, error: error instanceof Error && error.message === 'too-large' ? 'tooLarge' : 'renderError' } }
})
watch(rendered, async () => {
  const seq = ++sequence
  slots.value = []
  await nextTick()
  if (seq !== sequence) return
  slots.value = Array.from(root.value?.querySelectorAll<HTMLElement>('[data-code-index]') ?? []).map((target) => ({ target, index: Number(target.dataset.codeIndex) }))
}, { immediate: true, flush: 'pre' })
onBeforeUnmount(() => { sequence++ })

function scrollToHeading(id: string) {
  const node = Array.from(root.value?.querySelectorAll<HTMLElement>('[id]') ?? []).find((item) => item.id === id)
  node?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
async function onClick(event: MouseEvent | KeyboardEvent) {
  if (event instanceof KeyboardEvent && event.key !== 'Enter') return
  const target = event.target instanceof Element ? event.target.closest('a') : null
  if (!target) return
  event.preventDefault()
  if (target.dataset.unresolved) { showError(t('diff.markdown.unresolvedLink')); return }
  const href = target.getAttribute('href') ?? ''
  if (href.startsWith('#')) { scrollToHeading(href.slice(1)); return }
  const url = safeExternalUrl(href)
  if (url) {
    try { await openUrl(url) }
    catch (error: unknown) { showActionError(error, t('diff.markdown.openLinkFailed')) }
  }
}
</script>

<template>
  <div class="markdown-preview">
    <div v-if="rendered.error" class="markdown-notice" role="status">{{ t('diff.markdown.' + rendered.error) }}</div>
    <template v-else-if="rendered.result">
      <div v-if="rendered.result.headings.length" class="markdown-outline">
        <label>{{ t('diff.markdown.outline') }}
          <select :aria-label="t('diff.markdown.outline')" value="" @change="scrollToHeading(($event.target as HTMLSelectElement).value)">
            <option value="" disabled>{{ t('diff.markdown.jumpHeading') }}</option>
            <option v-for="heading in rendered.result.headings" :key="heading.id" :value="heading.id">{{ '　'.repeat(heading.level - 1) + heading.text }}</option>
          </select>
        </label>
      </div>
      <div v-if="rendered.result.remoteImages" class="markdown-notice">{{ t('diff.markdown.remoteImagesHidden') }}</div>
      <div v-if="rendered.result.relativeImages" class="markdown-notice">{{ t('diff.markdown.relativeImages') }}</div>
      <article ref="root" class="markdown-prose" @click="onClick" @keydown="onClick" @auxclick.prevent v-html="rendered.result.html" />
      <Teleport v-for="slot in slots" :key="slot.index" :to="slot.target">
        <MarkdownCodeBlock :code="rendered.result.codes[slot.index]" :mermaid-enabled="mermaidEnabled" :highlight="highlight" />
      </Teleport>
      <div v-if="!text.trim()" class="markdown-notice">{{ t('diff.markdown.empty') }}</div>
    </template>
  </div>
</template>

<style scoped>
.markdown-preview { max-width: 1000px; min-width: 0; margin: 0 auto; padding: 16px 24px 40px; font-size: var(--font-base); }
.markdown-outline { margin-bottom: 16px; color: var(--text-muted); font-size: var(--font-sm); }
.markdown-outline label { display: flex; align-items: center; gap: 8px; }
select { min-width: 0; flex: 1; max-width: 500px; padding: 4px; background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border); border-radius: 4px; font: inherit; }
.markdown-notice { padding: 10px; margin-bottom: 12px; background: var(--bg-surface); border-radius: 4px; color: var(--text-muted); font-size: var(--font-sm); overflow-wrap: anywhere; }
.markdown-prose { color: var(--text-primary); line-height: 1.7; overflow-wrap: anywhere; }
.markdown-prose, .markdown-prose :deep(*) { user-select: text; -webkit-user-select: text; }
.markdown-prose :deep(h1), .markdown-prose :deep(h2) { padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
.markdown-prose :deep(h1) { font-size: 2em; }
.markdown-prose :deep(h2) { font-size: 1.5em; }
.markdown-prose :deep(h3) { font-size: 1.25em; }
.markdown-prose :deep(h4) { font-size: 1.1em; }
.markdown-prose :deep(h5), .markdown-prose :deep(h6) { font-size: 1em; }
.markdown-prose :deep(h1), .markdown-prose :deep(h2), .markdown-prose :deep(h3), .markdown-prose :deep(h4), .markdown-prose :deep(h5), .markdown-prose :deep(h6) { font-weight: 600; margin: 1.3em 0 0.6em; scroll-margin-top: 16px; }
.markdown-prose :deep(p), .markdown-prose :deep(ul), .markdown-prose :deep(ol), .markdown-prose :deep(blockquote), .markdown-prose :deep(table), .markdown-prose :deep(details) { margin: 0 0 1em; }
.markdown-prose :deep(ul) { list-style: disc; padding-left: 2em; }
.markdown-prose :deep(ol) { list-style: decimal; padding-left: 2em; }
.markdown-prose :deep(li > p) { margin: 0.25em 0; }
.markdown-prose :deep(li input) { margin-right: 0.4em; }
.markdown-prose :deep(blockquote) { border-left: 4px solid var(--border); padding: 0 1em; color: var(--text-secondary); }
.markdown-prose :deep(a) { color: var(--accent-blue); text-decoration: underline; cursor: pointer; }
.markdown-prose :deep(code:not(pre code)), .markdown-prose :deep(kbd) { font-family: var(--code-font-family); background: var(--bg-surface); padding: 0.15em 0.35em; border-radius: 4px; font-size: 0.9em; }
.markdown-prose :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.markdown-prose :deep(th), .markdown-prose :deep(td) { padding: 6px 12px; border: 1px solid var(--border); }
.markdown-prose :deep(th), .markdown-prose :deep(tr:nth-child(even)) { background: var(--bg-surface); }
.markdown-prose :deep(img) { max-width: 100%; height: auto; }
.markdown-prose :deep(hr) { border: 0; border-top: 1px solid var(--border); margin: 1.5em 0; }
.markdown-prose :deep(summary) { cursor: pointer; font-weight: 600; }
.markdown-prose :deep(.markdown-image-placeholder) { color: var(--text-muted); border: 1px dashed var(--border); padding: 4px 8px; display: inline-block; }
@media (max-width: 700px) { .markdown-preview { padding: 12px; } }
</style>
