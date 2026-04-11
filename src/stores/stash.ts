import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { StashEntry } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'
import { useWorkspaceStore } from './workspace'
import { useHistoryStore } from './history'

export const useStashStore = defineStore('stash', () => {
  const entries = ref<StashEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const git = useGitCommands()

  async function refresh() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) {
      entries.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      entries.value = await git.stashList(repoStore.activeRepoId)
    } catch (e) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  async function push(message?: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.stashPush(repoStore.activeRepoId, message)
    const workspaceStore = useWorkspaceStore()
    await Promise.all([refresh(), workspaceStore.refresh()])
  }

  async function pop() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.stashPop(repoStore.activeRepoId)
    const workspaceStore = useWorkspaceStore()
    const historyStore = useHistoryStore()
    await Promise.all([
      refresh(),
      workspaceStore.refresh(),
      historyStore.loadLog(),
    ])
  }

  function reset() {
    entries.value = []
    error.value = null
  }

  return {
    entries,
    loading,
    error,
    refresh,
    push,
    pop,
    reset,
  }
})
