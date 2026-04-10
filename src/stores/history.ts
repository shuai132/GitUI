import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CommitInfo, BranchInfo, CommitDetail } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'

const PAGE_SIZE = 200

export const useHistoryStore = defineStore('history', () => {
  const commits = ref<CommitInfo[]>([])
  const branches = ref<BranchInfo[]>([])
  const selectedCommit = ref<CommitDetail | null>(null)
  const hasMore = ref(false)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)

  const git = useGitCommands()

  async function loadLog() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return

    loading.value = true
    error.value = null
    try {
      const page = await git.getLog(repoStore.activeRepoId, 0, PAGE_SIZE)
      commits.value = page.commits
      hasMore.value = page.has_more
    } catch (e: unknown) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId || !hasMore.value) return

    loadingMore.value = true
    try {
      const page = await git.getLog(repoStore.activeRepoId, commits.value.length, PAGE_SIZE)
      commits.value.push(...page.commits)
      hasMore.value = page.has_more
    } finally {
      loadingMore.value = false
    }
  }

  async function loadBranches() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return

    try {
      branches.value = await git.listBranches(repoStore.activeRepoId)
    } catch (e: unknown) {
      error.value = String(e)
    }
  }

  async function selectCommit(oid: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return

    try {
      selectedCommit.value = await git.getCommitDetail(repoStore.activeRepoId, oid)
    } catch (e: unknown) {
      error.value = String(e)
    }
  }

  async function createBranch(name: string, fromOid?: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.createBranch(repoStore.activeRepoId, name, fromOid)
    await loadBranches()
  }

  async function switchBranch(name: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.switchBranch(repoStore.activeRepoId, name)
    await Promise.all([loadLog(), loadBranches()])
  }

  async function deleteBranch(name: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.deleteBranch(repoStore.activeRepoId, name)
    await loadBranches()
  }

  function reset() {
    commits.value = []
    branches.value = []
    selectedCommit.value = null
    hasMore.value = false
  }

  return {
    commits,
    branches,
    selectedCommit,
    hasMore,
    loading,
    loadingMore,
    error,
    loadLog,
    loadMore,
    loadBranches,
    selectCommit,
    createBranch,
    switchBranch,
    deleteBranch,
    reset,
  }
})
