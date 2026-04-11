import { defineStore } from 'pinia'
import { ref } from 'vue'

const LAYOUT_KEY = 'gitui.history.layout'
const SHOW_UNREACHABLE_KEY = 'gitui.history.showUnreachable'
const SHOW_STASHES_KEY = 'gitui.history.showStashes'

function readBool(key: string, defaultValue: boolean): boolean {
  const v = localStorage.getItem(key)
  if (v === null) return defaultValue
  return v === 'true'
}

export const useUiStore = defineStore('ui', () => {
  const shouldOpenDiscardAll = ref(false)

  /** 提交历史的搜索关键词（AppToolbar 搜索框 ↔ HistoryView 过滤） */
  const historySearchQuery = ref('')

  /** 提交历史的面板布局，持久化到 localStorage */
  const historyLayoutMode = ref<'horizontal' | 'vertical'>(
    (localStorage.getItem(LAYOUT_KEY) as 'horizontal' | 'vertical') ?? 'vertical',
  )

  /** 是否在历史图里显示丢失引用的提交（仅 reflog 可达），默认关闭 */
  const showUnreachableCommits = ref<boolean>(
    readBool(SHOW_UNREACHABLE_KEY, false),
  )

  /** 是否在历史图里显示 stash commit，默认开启 */
  const showStashCommits = ref<boolean>(readBool(SHOW_STASHES_KEY, true))

  function toggleHistoryLayout() {
    historyLayoutMode.value =
      historyLayoutMode.value === 'horizontal' ? 'vertical' : 'horizontal'
    localStorage.setItem(LAYOUT_KEY, historyLayoutMode.value)
  }

  function toggleShowUnreachable() {
    showUnreachableCommits.value = !showUnreachableCommits.value
    localStorage.setItem(SHOW_UNREACHABLE_KEY, String(showUnreachableCommits.value))
  }

  function toggleShowStashes() {
    showStashCommits.value = !showStashCommits.value
    localStorage.setItem(SHOW_STASHES_KEY, String(showStashCommits.value))
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
    showUnreachableCommits,
    showStashCommits,
    toggleHistoryLayout,
    toggleShowUnreachable,
    toggleShowStashes,
    requestDiscardAll,
    consumeDiscardAllRequest,
  }
})
