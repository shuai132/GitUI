import { ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useBlurOnOutsidePointerDown } from '@/composables/useBlurOnOutsidePointerDown'

type FindCapableWindow = Window & {
  find?: (
    string: string,
    caseSensitive?: boolean,
    backwards?: boolean,
    wrapAround?: boolean,
    wholeWord?: boolean,
    searchInFrames?: boolean,
    showDialog?: boolean,
  ) => boolean
}

export function useDiffSearch() {
  const uiStore = useUiStore()
  const searchBoxEl = ref<HTMLElement | null>(null)
  const searchInputEl = ref<HTMLInputElement | null>(null)
  const searchExpanded = ref(false)
  let lastSelection: Range | null = null

  function focusDiffView() {
    const el = searchInputEl.value?.closest('.diff-view') as HTMLElement | null
    el?.focus()
  }

  function expandSearch() {
    searchExpanded.value = true
    setTimeout(() => searchInputEl.value?.focus(), 0)
  }

  function onSearchBlur() {
    if (!uiStore.diffSearchQuery) {
      searchExpanded.value = false
    }
  }

  function findNext(backward = false) {
    if (!uiStore.diffSearchQuery) return

    const sel = window.getSelection()
    if (lastSelection && sel) {
      sel.removeAllRanges()
      sel.addRange(lastSelection)
    }

    const findInPage = (window as FindCapableWindow).find
    const found = findInPage?.(uiStore.diffSearchQuery, false, backward, true, false, false, false) ?? false

    if (found && sel && sel.rangeCount > 0) {
      lastSelection = sel.getRangeAt(0).cloneRange()
    } else {
      lastSelection = null
    }
  }

  function clearSearch() {
    uiStore.diffSearchQuery = ''
    searchExpanded.value = false
    lastSelection = null
    searchInputEl.value?.blur()
    focusDiffView()
  }

  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      clearSearch()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      findNext(e.shiftKey)
    }
  }

  watch(() => uiStore.openDiffSearchSignal, () => {
    expandSearch()
  })

  watch(() => uiStore.diffSearchQuery, () => {
    lastSelection = null
  })

  useBlurOnOutsidePointerDown(searchBoxEl, () => {
    if (!uiStore.diffSearchQuery) {
      searchExpanded.value = false
    }
  })

  return {
    searchBoxEl,
    searchInputEl,
    searchExpanded,
    expandSearch,
    onSearchBlur,
    onSearchKeydown,
    findNext,
    clearSearch,
  }
}
