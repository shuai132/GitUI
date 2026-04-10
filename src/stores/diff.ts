import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { FileDiff } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'

export const useDiffStore = defineStore('diff', () => {
  const currentDiff = ref<FileDiff | null>(null)
  const currentPath = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const git = useGitCommands()

  async function loadFileDiff(filePath: string, staged: boolean) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return

    loading.value = true
    error.value = null
    currentPath.value = filePath
    try {
      currentDiff.value = await git.getFileDiff(repoStore.activeRepoId, filePath, staged)
    } catch (e: unknown) {
      error.value = String(e)
      currentDiff.value = null
    } finally {
      loading.value = false
    }
  }

  function clear() {
    currentDiff.value = null
    currentPath.value = null
    error.value = null
  }

  return {
    currentDiff,
    currentPath,
    loading,
    error,
    loadFileDiff,
    clear,
  }
})
