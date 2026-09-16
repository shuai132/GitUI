import { nextTick, onScopeDispose, watch, type Ref } from 'vue'
import type { CommitInfo } from '@/types/git'

interface HistoryScrollAnchorOptions {
  commits: () => readonly CommitInfo[]
  contextKey: () => string
  wipVisible: () => boolean
  rowHeight: () => number
  scrollContainer: Ref<HTMLElement | null>
}

export function useHistoryScrollAnchor(options: HistoryScrollAnchorOptions) {
  interface Anchor {
    element: HTMLElement
    top: number
    oid: string
    offset: number
  }
  let pending: Anchor | null = null
  watch(
    () => [options.commits(), options.contextKey(), options.wipVisible(), options.rowHeight()] as const,
    ([, context, , height], [previous, oldContext, oldWip, oldHeight]) => {
      if (context !== oldContext || height !== oldHeight) {
        pending = null
        return
      }
      const element = options.scrollContainer.value
      if (!element || element.scrollTop <= 0 || height <= 0) return
      if (pending?.element === element && pending.top === element.scrollTop) return
      const row = Math.floor(element.scrollTop / height)
      const commit = previous[row - Number(oldWip)]
      if (!commit) return
      const anchor: Anchor = {
        element,
        top: element.scrollTop,
        oid: commit.oid,
        offset: element.scrollTop % height,
      }
      pending = anchor
      void nextTick(() => {
        if (pending !== anchor) return
        pending = null
        if (options.scrollContainer.value !== element || element.scrollTop !== anchor.top ||
          options.contextKey() !== context || options.rowHeight() !== height) return
        const index = options.commits().findIndex((entry) => entry.oid === anchor.oid)
        if (index < 0) return
        const top = (index + Number(options.wipVisible())) * height + anchor.offset
        if (top !== element.scrollTop) element.scrollTo({ top, behavior: 'instant' })
      })
    },
    { flush: 'sync' },
  )
  onScopeDispose(() => { pending = null })
}
