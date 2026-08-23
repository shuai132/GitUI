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
  let refreshSeq = 0

  async function refresh() {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) {
      entries.value = []
      return
    }
    const requestSeq = ++refreshSeq
    loading.value = true
    error.value = null
    try {
      const next = await git.stashList(repoId)
      if (requestSeq !== refreshSeq || repoStore.activeRepoId !== repoId) return
      entries.value = next
    } catch (e) {
      if (requestSeq === refreshSeq && repoStore.activeRepoId === repoId) {
        error.value = String(e)
      }
    } finally {
      if (requestSeq === refreshSeq) loading.value = false
    }
  }

  async function push(message?: string, repoId?: string) {
    const repoStore = useRepoStore()
    const id = repoId ?? repoStore.activeRepoId
    if (!id) return
    await git.stashPush(id, message)
    if (repoStore.activeRepoId !== id) return
    const workspaceStore = useWorkspaceStore()
    await Promise.all([refresh(), workspaceStore.refresh(id)])
  }

  async function pop(repoId: string, index = 0, expectedOid?: string) {
    const repoStore = useRepoStore()
    await git.stashPop(repoId, index, expectedOid)
    if (repoStore.activeRepoId !== repoId) return
    const workspaceStore = useWorkspaceStore()
    const historyStore = useHistoryStore()
    await Promise.all([
      refresh(),
      workspaceStore.refresh(repoId),
      historyStore.loadLog(),
    ])
  }

  async function apply(repoId: string, index: number, expectedOid: string) {
    const repoStore = useRepoStore()
    await git.stashApply(repoId, index, expectedOid)
    if (repoStore.activeRepoId !== repoId) return
    // apply 不移除 stash 条目，但会改动工作区，需要刷新
    const workspaceStore = useWorkspaceStore()
    await workspaceStore.refresh(repoId)
  }

  async function drop(repoId: string, index: number, expectedOid?: string) {
    const repoStore = useRepoStore()
    await git.stashDrop(repoId, index, expectedOid)
    if (repoStore.activeRepoId !== repoId) return
    // drop 只删除 stash 条目，但历史图里若绘制了 stash 节点也要刷新
    const historyStore = useHistoryStore()
    await Promise.all([refresh(), historyStore.loadLog()])
  }

  function reset() {
    refreshSeq++
    entries.value = []
    loading.value = false
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
