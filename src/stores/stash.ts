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

  async function pop(index = 0) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.stashPop(repoStore.activeRepoId, index)
    const workspaceStore = useWorkspaceStore()
    const historyStore = useHistoryStore()
    await Promise.all([
      refresh(),
      workspaceStore.refresh(),
      historyStore.loadLog(),
    ])
  }

  async function apply(index: number) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.stashApply(repoStore.activeRepoId, index)
    // apply 不移除 stash 条目，但会改动工作区，需要刷新
    const workspaceStore = useWorkspaceStore()
    await workspaceStore.refresh()
  }

  async function drop(index: number) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.stashDrop(repoStore.activeRepoId, index)
    // drop 只删除 stash 条目，但历史图里若绘制了 stash 节点也要刷新
    const historyStore = useHistoryStore()
    await Promise.all([refresh(), historyStore.loadLog()])
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
    apply,
    drop,
    reset,
  }
})
