import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CommitInfo, BranchInfo, CommitDetail, TagInfo } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'
import { useUiStore } from './ui'
import { computeGraphLayout, type GraphRow, type LaneState } from '@/utils/graph'

const PAGE_SIZE = 200

export const useHistoryStore = defineStore('history', () => {
  const commits = ref<CommitInfo[]>([])
  const branches = ref<BranchInfo[]>([])
  const tags = ref<TagInfo[]>([])
  // 远端已存在的 tag 短名集合（任一 remote 命中即算已同步）。
  // 通过 list_remote_tags 懒加载，失败时 remoteTagsChecked 保持 false，UI 显示"未知"。
  const remoteTagNames = ref<Set<string>>(new Set())
  const remoteTagsChecked = ref(false)
  const remoteTagsLoading = ref(false)
  const selectedCommit = ref<CommitDetail | null>(null)
  const selectedWip = ref(false)
  const showDetail = ref(false)
  const graphRows = ref<GraphRow[]>([])
  // loadMore 增量计算所需的末尾 lane 状态，loadLog 重置
  const graphLaneState = ref<LaneState | null>(null)
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
      // 若 HEAD / 尾部 / 总数 / has_more 都没变，且每个提交的可达/stash/reflog-tip 标志
      // 也没变，认为提交序列的结构与渲染相关信息都未改动，跳过赋值避免响应式重渲染
      // （watcher 在纯 worktree 变更时大量出现此情况）。reset --hard 等操作会翻转
      // 这些标志但不改变 oid 序列，所以必须逐项比对，否则悬垂样式不会立即更新。
      const prev = commits.value
      const next = page.commits
      let unchanged =
        next.length === prev.length &&
        page.has_more === hasMore.value &&
        next[0]?.oid === prev[0]?.oid &&
        next[next.length - 1]?.oid === prev[prev.length - 1]?.oid
      if (unchanged) {
        for (let i = 0; i < next.length; i++) {
          const a = next[i]
          const b = prev[i]
          if (
            a.oid !== b.oid ||
            a.is_unreachable !== b.is_unreachable ||
            a.is_stash !== b.is_stash ||
            a.is_reflog_tip !== b.is_reflog_tip
          ) {
            unchanged = false
            break
          }
        }
      }
      if (!unchanged) {
        commits.value = next
        hasMore.value = page.has_more
        const { rows, finalState } = computeGraphLayout(commits.value)
        graphRows.value = rows
        graphLaneState.value = finalState
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
      // 只计算新增的这一页，从上次的末尾 lane 状态接续，O(200) 而非 O(N)
      const { rows: newRows, finalState } = computeGraphLayout(
        page.commits,
        graphLaneState.value ?? undefined,
      )
      commits.value.push(...page.commits)
      hasMore.value = page.has_more
      graphRows.value.push(...newRows)
      graphLaneState.value = finalState
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

  async function switchBranch(name: string, force = false) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.switchBranch(repoStore.activeRepoId, name, force)
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

  async function dropUnreachableCommit(oid: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return 0
    const removed = await git.dropUnreachableCommit(repoStore.activeRepoId, oid)
    await loadLog()
    return removed
  }

  async function previewDropUnreachableCommit(oid: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return 0
    return await git.previewDropUnreachableCommit(repoStore.activeRepoId, oid)
  }

  async function amendCommitMessage(message: string, authorTime?: number, committerTime?: number, authorName?: string, authorEmail?: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.amendCommitMessage(repoStore.activeRepoId, message, authorTime, committerTime, authorName, authorEmail)
    await Promise.all([loadLog(), loadBranches()])
    if (selectedCommit.value) {
      await selectCommit(selectedCommit.value.info.oid)
    }
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
    // 删了就不应再被视为"已同步到远程"——即便远端仍存在也无法对应
    if (remoteTagNames.value.has(name)) {
      const next = new Set(remoteTagNames.value)
      next.delete(name)
      remoteTagNames.value = next
    }
    await loadTags()
  }

  /// 并发查询所有 remote 的 tag 列表，合并成 set；失败的 remote 跳过。
  /// 至少一个 remote 成功即 remoteTagsChecked = true；全部失败（通常是无网络 / 认证错误）
  /// 保持 false，让前端显示"未知"态而不是误判成"仅本地"。
  async function loadRemoteTags() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    if (remoteTagsLoading.value) return
    remoteTagsLoading.value = true
    try {
      const repoId = repoStore.activeRepoId
      const remotes = await git.listRemotes(repoId).catch(() => [] as string[])
      if (remotes.length === 0) {
        // 无 remote：认为已检查，所有 tag 都是"仅本地"
        remoteTagsChecked.value = true
        remoteTagNames.value = new Set()
        return
      }
      const results = await Promise.all(
        remotes.map(r =>
          git.listRemoteTags(repoId, r).then(
            names => ({ ok: true as const, names }),
            () => ({ ok: false as const, names: [] as string[] }),
          ),
        ),
      )
      const merged = new Set<string>()
      let anySuccess = false
      for (const r of results) {
        if (r.ok) {
          anySuccess = true
          for (const n of r.names) merged.add(n)
        }
      }
      if (anySuccess) {
        remoteTagNames.value = merged
        remoteTagsChecked.value = true
      }
    } finally {
      remoteTagsLoading.value = false
    }
  }

  /// push 成功后乐观更新，避免再等一次 ls-remote。
  function markTagPushed(name: string) {
    if (!remoteTagNames.value.has(name)) {
      const next = new Set(remoteTagNames.value)
      next.add(name)
      remoteTagNames.value = next
    }
    // 即使之前没拉过远程 tag，这里也能确认"至少这个在远端"
    remoteTagsChecked.value = true
  }

  function reset() {
    commits.value = []
    branches.value = []
    tags.value = []
    remoteTagNames.value = new Set()
    remoteTagsChecked.value = false
    remoteTagsLoading.value = false
    selectedCommit.value = null
    selectedWip.value = false
    showDetail.value = false
    graphRows.value = []
    selectedFileDiffIndex.value = 0
    hasMore.value = false
  }

  return {
    commits,
    branches,
    tags,
    remoteTagNames,
    remoteTagsChecked,
    remoteTagsLoading,
    selectedCommit,
    selectedWip,
    showDetail,
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
    loadRemoteTags,
    markTagPushed,
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
    dropUnreachableCommit,
    previewDropUnreachableCommit,
    amendCommitMessage,
    createTag,
    deleteTag,
    reset,
  }
})
