import { defineStore } from 'pinia'
import { ref } from 'vue'

const LAYOUT_KEY = 'gitui.history.layout'

export const useUiStore = defineStore('ui', () => {
  const shouldOpenDiscardAll = ref(false)

  /** 提交历史的搜索关键词（AppToolbar 搜索框 ↔ HistoryView 过滤） */
  const historySearchQuery = ref('')

  /** 提交历史的面板布局，持久化到 localStorage */
  const historyLayoutMode = ref<'horizontal' | 'vertical'>(
    (localStorage.getItem(LAYOUT_KEY) as 'horizontal' | 'vertical') ?? 'vertical',
  )

  function toggleHistoryLayout() {
    historyLayoutMode.value =
      historyLayoutMode.value === 'horizontal' ? 'vertical' : 'horizontal'
    localStorage.setItem(LAYOUT_KEY, historyLayoutMode.value)
  }

  function requestDiscardAll() {
    shouldOpenDiscardAll.value = true
  }

  function consumeDiscardAllRequest() {
    shouldOpenDiscardAll.value = false
  }

  return {
    shouldOpenDiscardAll,
    historySearchQuery,
    historyLayoutMode,
    toggleHistoryLayout,
    requestDiscardAll,
    consumeDiscardAllRequest,
  }
})
