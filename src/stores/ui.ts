import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 跨组件的 UI 协作状态。
 * 用来在 AppToolbar 和 HistoryView / WipPanel 之间传递「触发某动作」的信号。
 *
 * - searchFocusTick: 单调递增 tick，Search 按钮 → HistoryView 聚焦搜索框
 * - shouldOpenDiscardAll: 粘性布尔，Actions 菜单 / WipPanel → 请求弹出"丢弃全部"确认框；
 *   消费者读到 true 后必须调 consumeDiscardAllRequest() 把它清回 false。
 *   用粘性 flag 而不是 tick 是为了处理 WipPanel 新挂载时错过 tick 的情况。
 */
export const useUiStore = defineStore('ui', () => {
  const searchFocusTick = ref(0)
  const shouldOpenDiscardAll = ref(false)

  function focusSearch() {
    searchFocusTick.value++
  }

  function requestDiscardAll() {
    shouldOpenDiscardAll.value = true
  }

  function consumeDiscardAllRequest() {
    shouldOpenDiscardAll.value = false
  }

  return {
    searchFocusTick,
    shouldOpenDiscardAll,
    focusSearch,
    requestDiscardAll,
    consumeDiscardAllRequest,
  }
})
