import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CommitInfo, BranchInfo, CommitDetail } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'
import { computeGraphLayout, type GraphRow } from '@/utils/graph'

const PAGE_SIZE = 200

export const useHistoryStore = defineStore('history', () => {
  const commits = ref<CommitInfo[]>([])
  const branches = ref<BranchInfo[]>([])
  const selectedCommit = ref<CommitDetail | null>(null)
  const graphRows = ref<GraphRow[]>([])
  const selectedFileDiffIndex = ref(0)
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
      graphRows.value = computeGraphLayout(commits.value)
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
      graphRows.value = computeGraphLayout(commits.value)
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

    selectedFileDiffIndex.value = 0
    try {
      selectedCommit.value = await git.getCommitDetail(repoStore.activeRepoId, oid)
    } catch (e: unknown) {
      error.value = String(e)
    }
  }

  function selectFileDiff(idx: number) {
    selectedFileDiffIndex.value = idx
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

  async function checkoutRemoteBranch(
    remoteBranch: string,
    localName: string,
    track: boolean,
  ) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.checkoutRemoteBranch(
      repoStore.activeRepoId,
      remoteBranch,
      localName,
      track,
    )
    await Promise.all([loadLog(), loadBranches()])
  }

  // ── 提交级操作 ────────────────────────────────────────────────────

  async function checkoutCommit(oid: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.checkoutCommit(repoStore.activeRepoId, oid)
    // HEAD detached 后需要刷新分支列表和日志
    await Promise.all([loadLog(), loadBranches()])
  }

  async function cherryPickCommit(oid: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.cherryPickCommit(repoStore.activeRepoId, oid)
    await Promise.all([loadLog(), loadBranches()])
  }

  async function revertCommit(oid: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.revertCommit(repoStore.activeRepoId, oid)
    await Promise.all([loadLog(), loadBranches()])
  }

  async function resetToCommit(oid: string, mode: 'soft' | 'mixed' | 'hard') {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.resetToCommit(repoStore.activeRepoId, oid, mode)
    await Promise.all([loadLog(), loadBranches()])
  }

  async function createTag(name: string, oid: string, message: string | null) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.createTag(repoStore.activeRepoId, name, oid, message)
    // 标签列表暂未在 UI 展示，无需 refresh
  }

  function reset() {
    commits.value = []
    branches.value = []
    selectedCommit.value = null
    graphRows.value = []
    selectedFileDiffIndex.value = 0
    hasMore.value = false
  }

  return {
    commits,
    branches,
    selectedCommit,
    graphRows,
    selectedFileDiffIndex,
    hasMore,
    loading,
    loadingMore,
    error,
    loadLog,
    loadMore,
    loadBranches,
    selectCommit,
    selectFileDiff,
    createBranch,
    switchBranch,
    deleteBranch,
    checkoutRemoteBranch,
    checkoutCommit,
    cherryPickCommit,
    revertCommit,
    resetToCommit,
    createTag,
    reset,
  }
})
