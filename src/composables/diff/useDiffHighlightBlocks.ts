import { onMounted, onScopeDispose, provide, watch, type InjectionKey, type Ref } from 'vue'

export const DIFF_BLOCK_LINES = 128

export function chunkDiffRows<T>(rows: readonly T[], start = 0) {
  const blocks: { start: number; rows: readonly T[] }[] = []
  for (let offset = 0; offset < rows.length; offset += DIFF_BLOCK_LINES) {
    blocks.push({ start: start + offset, rows: rows.slice(offset, offset + DIFF_BLOCK_LINES) })
  }
  return blocks
}

type ObserveBlock = (element: HTMLElement, activate: () => void) => () => void
export const diffHighlightBlocksKey: InjectionKey<ObserveBlock> = Symbol('diff-highlight-blocks')

export function diffSelectionIntersects(element: HTMLElement, selection: Selection | null, includeCollapsed = false): boolean {
  if (!selection || (selection.isCollapsed && !includeCollapsed)) return false
  for (let i = 0; i < selection.rangeCount; i++) {
    if (selection.getRangeAt(i).intersectsNode(element)) return true
  }
  return false
}

/** 保留纯文本 DOM，只推迟昂贵的词级比较和语法 token；一个 Diff 共用一个观察器。 */
export function useDiffHighlightBlocks(root: Ref<HTMLElement | null>) {
  const blocks = new Map<HTMLElement, () => void>()
  const visible = new Set<HTMLElement>()
  let observer: IntersectionObserver | null = null
  let selecting = false

  function activateVisible() {
    const selection = window.getSelection()
    for (const element of visible) {
      // 替换 innerHTML 会使原生搜索 / 拖选的 Range 失效，待选区离开后再高亮。
      if (diffSelectionIntersects(element, selection, selecting)) continue
      blocks.get(element)?.()
      observer?.unobserve(element)
      blocks.delete(element)
      visible.delete(element)
    }
  }

  provide(diffHighlightBlocksKey, (element, activate) => {
    if (typeof IntersectionObserver === 'undefined') {
      activate()
      return () => undefined
    }
    blocks.set(element, activate)
    observer?.observe(element)
    return () => {
      observer?.unobserve(element)
      blocks.delete(element)
      visible.delete(element)
    }
  })

  watch(root, (element) => {
    observer?.disconnect()
    observer = null
    visible.clear()
    if (!element || typeof IntersectionObserver === 'undefined') return
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement
        if (entry.isIntersecting) visible.add(target)
        else visible.delete(target)
      }
      activateVisible()
    }, { root: element, rootMargin: '600px 0px' })
    for (const target of blocks.keys()) observer.observe(target)
  }, { flush: 'post' })

  function onPointerDown() { selecting = true }
  function onPointerUp() {
    selecting = false
    activateVisible()
  }

  onMounted(() => {
    document.addEventListener('selectionchange', activateVisible)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerUp, true)
  })
  onScopeDispose(() => {
    observer?.disconnect()
    blocks.clear()
    visible.clear()
    document.removeEventListener('selectionchange', activateVisible)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', onPointerUp, true)
  })
}
