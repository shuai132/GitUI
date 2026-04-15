import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { FileDiff } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'

export const useDiffStore = defineStore('diff', () => {
  const currentDiff = ref<FileDiff | null>(null)
  const currentPath = ref<string | null>(null)
  /** 当前加载的 diff 对应的 staged 侧（staged/unstaged），用于 refresh() */
  const currentStaged = ref<boolean>(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const git = useGitCommands()

  async function loadFileDiff(filePath: string, staged: boolean) {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return

    loading.value = true
    error.value = null
    currentPath.value = filePath
    currentStaged.value = staged
    try {
      const result = await git.getFileDiff(repoId, filePath, staged)
      // 丢弃过期响应：await 期间用户可能已切换到其他仓库，
      // 此时 repoId 与当前活跃仓库不符，写入会污染新仓库的 diff
      if (repoId !== repoStore.activeRepoId) return
      currentDiff.value = result
    } catch (e: unknown) {
      error.value = String(e)
      currentDiff.value = null
    } finally {
      loading.value = false
    }
  }

  /**
   * 重新拉取当前选中文件的 diff。
   * 供文件系统监听器在 status-changed 事件上调用，让 WIP 模式下的 diff
   * 随工作区实际内容自动刷新。currentPath 为 null 时是 no-op。
   */
  async function refresh() {
    if (currentPath.value === null) return
    await loadFileDiff(currentPath.value, currentStaged.value)
  }

  function clear() {
    currentDiff.value = null
    currentPath.value = null
    currentStaged.value = false
    error.value = null
  }

  return {
    currentDiff,
    currentPath,
    currentStaged,
    loading,
    error,
    loadFileDiff,
    refresh,
    clear,
  }
})
