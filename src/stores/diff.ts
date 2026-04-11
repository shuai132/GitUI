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
    if (!repoStore.activeRepoId) return

    loading.value = true
    error.value = null
    currentPath.value = filePath
    currentStaged.value = staged
    try {
      currentDiff.value = await git.getFileDiff(repoStore.activeRepoId, filePath, staged)
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
