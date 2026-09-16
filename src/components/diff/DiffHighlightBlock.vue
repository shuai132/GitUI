<script setup lang="ts">
import { inject, onMounted, onScopeDispose, ref, watch } from 'vue'
import { diffHighlightBlocksKey, diffSelectionIntersects } from '@/composables/diff/useDiffHighlightBlocks'

const props = defineProps<{ initial: boolean; source: object }>()
const observe = inject(diffHighlightBlocksKey)
const root = ref<HTMLElement | null>(null)
const highlight = ref(props.initial || typeof IntersectionObserver === 'undefined')
let stop: (() => void) | undefined

function observePending() {
  stop?.()
  stop = undefined
  if (!highlight.value && root.value) {
    stop = observe?.(root.value, () => { highlight.value = true })
  }
}

onMounted(observePending)
watch(() => props.source, () => {
  // 同文件刷新内容未变时，已高亮选区继续复用文本节点，不能因重置惰性状态丢失选区。
  const selected = highlight.value && root.value && diffSelectionIntersects(root.value, window.getSelection())
  highlight.value = !!selected || props.initial || typeof IntersectionObserver === 'undefined'
  observePending()
}, { flush: 'sync' })
onScopeDispose(() => stop?.())
</script>

<template>
  <div ref="root" class="diff-highlight-block">
    <slot :highlight="highlight" />
  </div>
</template>
