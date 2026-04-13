import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CommitInfo, BranchInfo, CommitDetail, TagInfo } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'
import { useUiStore } from './ui'
import { computeGraphLayout, type GraphRow } from '@/utils/graph'

const PAGE_SIZE = 200

export const useHistoryStore = defineStore('history', () => {
  const commits = ref<CommitInfo[]>([])
  const branches = ref<BranchInfo[]>([])
  const tags = ref<TagInfo[]>([])
  const selectedCommit = ref<CommitDetail | null>(null)
  const graphRows = ref<GraphRow[]>([])
  const selectedFileDiffIndex = ref(0)
  const hasMore = ref(false)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)
  // 由侧边栏设置，HistoryView 消费后清空；用于从 sidebar 跳转到历史中某个 commit
  const pendingJumpOid = ref<string | null>(null)

  const git = useGitCommands()

  async function loadLog() {
    const repoStore = useRepoStore()
    const uiStore = useUiStore()
    if (!repoStore.activeRepoId) return

    loading.value = true
    error.value = null
    try {
      const page = await git.getLog(
        repoStore.activeRepoId,
        0,
        PAGE_SIZE,
        uiStore.showUnreachableCommits,
        uiStore.showStashCommits,
      )
      // 若 HEAD / 尾部 / 总数 / has_more 都没变，认为提交序列结构未改动，
      // 跳过赋值避免触发响应式重渲染（watcher 在纯 worktree 变更时大量出现此情况）
      const prev = commits.value
      const next = page.commits
      const unchanged =
        next.length === prev.length &&
        page.has_more === hasMore.value &&
        next[0]?.oid === prev[0]?.oid &&
        next[next.length - 1]?.oid === prev[prev.length - 1]?.oid
      if (!unchanged) {
        commits.value = next
        hasMore.value = page.has_more
        graphRows.value = computeGraphLayout(commits.value)
      }
    } catch (e: unknown) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    const repoStore = useRepoStore()
    const uiStore = useUiStore()
    if (!repoStore.activeRepoId || !hasMore.value) return

    loadingMore.value = true
    try {
      const page = await git.getLog(
        repoStore.activeRepoId,
        commits.value.length,
        PAGE_SIZE,
        uiStore.showUnreachableCommits,
        uiStore.showStashCommits,
      )
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
      const next = await git.listBranches(repoStore.activeRepoId)
      // 分支列表结构未变（数量、名称、指向的 oid、ahead/behind 都一样）时跳过
      const prev = branches.value
      const unchanged =
        next.length === prev.length &&
        next.every((b, i) =>
          b.name === prev[i].name &&
          b.commit_oid === prev[i].commit_oid &&
          b.is_head === prev[i].is_head &&
          b.ahead === prev[i].ahead &&
          b.behind === prev[i].behind,
        )
      if (!unchanged) branches.value = next
    } catch (e: unknown) {
      error.value = String(e)
    }
  }

  async function loadTags() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return

    try {
      const next = await git.listTags(repoStore.activeRepoId)
      const prev = tags.value
      const unchanged =
        next.length === prev.length &&
        next.every((t, i) =>
          t.name === prev[i].name && t.commit_oid === prev[i].commit_oid,
        )
      if (!unchanged) tags.value = next
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
    await loadTags()
  }

  async function deleteTag(name: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.deleteTag(repoStore.activeRepoId, name)
    await loadTags()
  }

  function reset() {
    commits.value = []
    branches.value = []
    tags.value = []
    selectedCommit.value = null
    graphRows.value = []
    selectedFileDiffIndex.value = 0
    hasMore.value = false
  }

  return {
    commits,
    branches,
    tags,
    selectedCommit,
    graphRows,
    selectedFileDiffIndex,
    hasMore,
    loading,
    loadingMore,
    error,
    pendingJumpOid,
    loadLog,
    loadMore,
    loadBranches,
    loadTags,
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
    deleteTag,
    reset,
  }
})
