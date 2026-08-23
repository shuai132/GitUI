import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  CommitInfo,
  BranchInfo,
  CommitDetail,
  CommitChangeStats,
  TagInfo,
  RemoteInfo,
} from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'
import { useUiStore } from './ui'
import { computeGraphLayout, type GraphRow, type LaneState } from '@/utils/graph'
import { orderedFileIndices } from '@/utils/fileOrderPrefs'

const PAGE_SIZE = 200
const CHANGE_STATS_BATCH_SIZE = 40
const SEARCH_LIMIT = 200

export const useHistoryStore = defineStore('history', () => {
  const commits = ref<CommitInfo[]>([])
  const branches = ref<BranchInfo[]>([])
  const remotes = ref<RemoteInfo[]>([])
  const tags = ref<TagInfo[]>([])
  // 远端已存在的 tag 短名集合（任一 remote 命中即算已同步）。
  // 通过 list_remote_tags 懒加载，失败时 remoteTagsChecked 保持 false，UI 显示"未知"。
  const remoteTagNames = ref<Set<string>>(new Set())
  const remoteTags = ref<TagInfo[]>([])
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
  const commitSearchResults = ref<CommitInfo[]>([])
  const commitSearchQuery = ref('')
  const commitSearchHasMore = ref(false)
  const commitSearchLoading = ref(false)
  const commitSearchError = ref<string | null>(null)
  // 由侧边栏设置，HistoryView 消费后清空；用于从 sidebar 跳转到历史中某个 commit
  const pendingJumpOid = ref<string | null>(null)
  // 由 App 设置，HistoryView 消费后清空；只把目标 commit 滚入视野，不选中也不打开详情
  const pendingRevealOid = ref<string | null>(null)
  const commitChangeStats = ref<Map<string, CommitChangeStats>>(new Map())
  const commitChangeStatsLoading = ref<Set<string>>(new Set())
  const commitChangeStatsFailed = ref<Set<string>>(new Set())
  const commitChangeStatsRepoId = ref<string | null>(null)

  const git = useGitCommands()
  const uiStore = useUiStore()
  let logRequestSeq = 0
  let branchesRequestSeq = 0
  let tagsRequestSeq = 0
  let remoteTagsRequestSeq = 0
  let remoteTagsLoadingRepoId: string | null = null
  let commitDetailRequestSeq = 0
  let fileDiffRequestSeq = 0
  let commitSearchRequestSeq = 0

  function activeRepoBranchScope() {
    const repoStore = useRepoStore()
    return uiStore.getHistoryBranchScope(repoStore.activeRepo()?.path)
  }

  function commitDiffPath(diff: CommitDetail['diffs'][number]): string {
    return diff.new_path ?? diff.old_path ?? ''
  }

  function firstOrderedFileDiffIndex(diffs: CommitDetail['diffs']): number {
    const repoStore = useRepoStore()
    const bucket = uiStore.getChangedFileOrder(repoStore.activeRepo()?.path)
    return orderedFileIndices(diffs, bucket, commitDiffPath)[0] ?? 0
  }

  function isActiveRepo(repoId: string): boolean {
    return useRepoStore().activeRepoId === repoId
  }

  function clearCommitChangeStats() {
    commitChangeStats.value = new Map()
    commitChangeStatsLoading.value = new Set()
    commitChangeStatsFailed.value = new Set()
  }

  function ensureCommitChangeStatsRepo(repoId: string) {
    if (commitChangeStatsRepoId.value === repoId) return
    commitChangeStatsRepoId.value = repoId
    clearCommitChangeStats()
  }

  function markStatsLoading(oids: string[]) {
    const next = new Set(commitChangeStatsLoading.value)
    for (const oid of oids) next.add(oid)
    commitChangeStatsLoading.value = next
  }

  function unmarkStatsLoading(oids: string[]) {
    const next = new Set(commitChangeStatsLoading.value)
    for (const oid of oids) next.delete(oid)
    commitChangeStatsLoading.value = next
  }

  function markStatsFailed(oids: string[]) {
    const next = new Set(commitChangeStatsFailed.value)
    for (const oid of oids) next.add(oid)
    commitChangeStatsFailed.value = next
  }

  async function ensureCommitChangeStats(oids: string[]) {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId || oids.length === 0) return
    ensureCommitChangeStatsRepo(repoId)

    const unique = Array.from(new Set(oids.filter(Boolean)))
    const missing = unique.filter(
      (oid) =>
        !commitChangeStats.value.has(oid) &&
        !commitChangeStatsLoading.value.has(oid) &&
        !commitChangeStatsFailed.value.has(oid),
    )
    if (missing.length === 0) return

    for (let i = 0; i < missing.length; i += CHANGE_STATS_BATCH_SIZE) {
      const batch = missing.slice(i, i + CHANGE_STATS_BATCH_SIZE)
      markStatsLoading(batch)
      try {
        const stats = await git.getCommitChangeStats(repoId, batch)
        if (!isActiveRepo(repoId) || commitChangeStatsRepoId.value !== repoId) return
        const next = new Map(commitChangeStats.value)
        for (const item of stats) next.set(item.oid, item)
        commitChangeStats.value = next
      } catch (e: unknown) {
        if (isActiveRepo(repoId) && commitChangeStatsRepoId.value === repoId) {
          error.value = String(e)
          markStatsFailed(batch)
        }
      } finally {
        if (commitChangeStatsRepoId.value === repoId) {
          unmarkStatsLoading(batch)
        }
      }
    }
  }

  async function loadLog() {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    const requestSeq = ++logRequestSeq
    ensureCommitChangeStatsRepo(repoId)

    loading.value = true
    error.value = null
    try {
      const page = await git.getLog(
        repoId,
        0,
        PAGE_SIZE,
        uiStore.showUnreachableCommits,
        uiStore.showStashCommits,
        activeRepoBranchScope(),
        uiStore.showRemoteBranches,
      )
      if (requestSeq !== logRequestSeq || !isActiveRepo(repoId)) return
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
      if (requestSeq === logRequestSeq && isActiveRepo(repoId)) {
        error.value = String(e)
      }
    } finally {
      if (requestSeq === logRequestSeq) loading.value = false
    }
  }

  async function loadMore() {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId || !hasMore.value || loadingMore.value) return

    const requestSeq = logRequestSeq
    const offset = commits.value.length
    loadingMore.value = true
    try {
      const page = await git.getLog(
        repoId,
        offset,
        PAGE_SIZE,
        uiStore.showUnreachableCommits,
        uiStore.showStashCommits,
        activeRepoBranchScope(),
        uiStore.showRemoteBranches,
      )
      if (
        requestSeq !== logRequestSeq ||
        !isActiveRepo(repoId) ||
        commits.value.length !== offset
      ) {
        return
      }
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

  function cancelCommitSearch() {
    commitSearchRequestSeq++
    commitSearchResults.value = []
    commitSearchQuery.value = ''
    commitSearchHasMore.value = false
    commitSearchLoading.value = false
    commitSearchError.value = null
  }

  async function searchCommits(query: string) {
    const normalizedQuery = query.trim()
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId || Array.from(normalizedQuery).length < 2) {
      cancelCommitSearch()
      return
    }

    const requestSeq = ++commitSearchRequestSeq
    commitSearchLoading.value = true
    commitSearchError.value = null
    try {
      const page = await git.searchCommits(
        repoId,
        normalizedQuery,
        SEARCH_LIMIT,
        uiStore.showUnreachableCommits,
        uiStore.showStashCommits,
        activeRepoBranchScope(),
        uiStore.showRemoteBranches,
      )
      if (requestSeq !== commitSearchRequestSeq || !isActiveRepo(repoId)) return
      commitSearchResults.value = page.commits
      commitSearchQuery.value = normalizedQuery
      commitSearchHasMore.value = page.has_more
    } catch (e: unknown) {
      if (requestSeq === commitSearchRequestSeq && isActiveRepo(repoId)) {
        commitSearchResults.value = []
        commitSearchQuery.value = normalizedQuery
        commitSearchHasMore.value = false
        commitSearchError.value = String(e)
      }
    } finally {
      if (requestSeq === commitSearchRequestSeq) commitSearchLoading.value = false
    }
  }

  async function ensureCommitLoaded(
    oid: string,
    shouldContinue: () => boolean = () => true,
  ): Promise<boolean> {
    if (commits.value.some((c) => c.oid === oid)) return true

    while (hasMore.value && shouldContinue()) {
      const before = commits.value.length
      await loadMore()
      if (commits.value.some((c) => c.oid === oid)) return true
      if (commits.value.length === before) break
    }

    return commits.value.some((c) => c.oid === oid)
  }

  async function loadBranches() {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    const requestSeq = ++branchesRequestSeq

    try {
      const [next, nextRemotes] = await Promise.all([
        git.listBranches(repoId),
        git.listRemotes(repoId).catch(() => [] as RemoteInfo[]),
      ])
      if (requestSeq !== branchesRequestSeq || !isActiveRepo(repoId)) return
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

      const prevRemotes = remotes.value
      const remotesUnchanged =
        nextRemotes.length === prevRemotes.length &&
        nextRemotes.every((r, i) => r.name === prevRemotes[i].name && r.url === prevRemotes[i].url)
      if (!remotesUnchanged) remotes.value = nextRemotes
    } catch (e: unknown) {
      if (requestSeq === branchesRequestSeq && isActiveRepo(repoId)) {
        error.value = String(e)
      }
    }
  }

  async function loadTags() {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    const requestSeq = ++tagsRequestSeq

    try {
      const next = await git.listTags(repoId)
      if (requestSeq !== tagsRequestSeq || !isActiveRepo(repoId)) return
      const prev = tags.value
      const unchanged =
        next.length === prev.length &&
        next.every((t, i) =>
          t.name === prev[i].name && t.commit_oid === prev[i].commit_oid,
        )
      if (!unchanged) tags.value = next
    } catch (e: unknown) {
      if (requestSeq === tagsRequestSeq && isActiveRepo(repoId)) {
        error.value = String(e)
      }
    }
  }

  const loadingDetail = ref(false)

  function isCurrentCommitDetailRequest(repoId: string, oid: string, requestSeq: number) {
    if (requestSeq !== commitDetailRequestSeq || !isActiveRepo(repoId) || selectedWip.value) {
      return false
    }
    const selectedOid = selectedCommit.value?.info.oid
    return !selectedOid || selectedOid === oid
  }

  async function selectCommit(oid: string) {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    const requestSeq = ++commitDetailRequestSeq

    // ── 第一步：瞬间响应 ──
    // 立即更新 selectedCommit 和 showDetail，让 UI 瞬间弹出并选中行。
    selectedWip.value = false
    const existing = commits.value.find((c) => c.oid === oid)
    if (existing) {
      selectedCommit.value = { info: existing, diffs: [] }
    } else {
      selectedCommit.value = null
    }
    showDetail.value = true

    selectedFileDiffIndex.value = 0
    loadingDetail.value = true

    // ── 第二步：将重负载推迟到下一帧 ──
    // 这样浏览器能先完成第一步的渲染（面板弹出、列表高亮），避免 IPC 序列化和后续逻辑阻塞主线程。
    setTimeout(async () => {
      // 校验用户是否已经切到了别的仓库、提交或 WIP。
      if (!isCurrentCommitDetailRequest(repoId, oid, requestSeq)) return

      try {
        // 快速加载文件列表 (includeStats=false)
        const summary = await git.getCommitSummary(repoId, oid, false)

        if (isCurrentCommitDetailRequest(repoId, oid, requestSeq)) {
          selectedCommit.value = summary
          loadingDetail.value = false

          // 默认加载视觉顺序里的第一个文件；仓库级排序偏好可能把原始第一个文件移到末尾。
          if (summary.diffs.length > 0) {
            selectFirstOrderedFileDiff()
          }

          // 后台补全统计数字
          git
            .getCommitSummary(repoId, oid, true)
            .then((fullSummary) => {
              if (!isCurrentCommitDetailRequest(repoId, oid, requestSeq)) return
              fullSummary.diffs.forEach((fd, i) => {
                const target = selectedCommit.value?.diffs[i]
                if (target && (target.new_path === fd.new_path || target.old_path === fd.old_path)) {
                  target.additions = fd.additions
                  target.deletions = fd.deletions
                }
              })
            })
            .catch((e) => console.error('Failed to load stats:', e))
        }
      } catch (e: unknown) {
        if (isCurrentCommitDetailRequest(repoId, oid, requestSeq)) {
          error.value = String(e)
          loadingDetail.value = false
        }
      }
    }, 0)
  }

  async function loadFileDiff(idx: number, force = false) {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    const commit = selectedCommit.value
    if (!repoId || !commit) return
    const oid = commit.info.oid

    const diff = commit.diffs[idx]
    // 已经加载过，或者是二进制文件（无 hunk），则跳过
    if (!diff || (!force && diff.hunks.length > 0) || diff.is_binary) return

    const requestSeq = ++fileDiffRequestSeq
    try {
      const path = diff.new_path || diff.old_path
      if (!path) return
      const fullDiff = await git.getFileDiffAtCommit(
        repoId,
        path,
        oid,
        uiStore.diffIgnoreWhitespace,
      )
      if (
        requestSeq !== fileDiffRequestSeq ||
        !isActiveRepo(repoId) ||
        selectedCommit.value?.info.oid !== oid
      ) return
      commit.diffs[idx] = fullDiff
    } catch (e: unknown) {
      console.error('Failed to load file diff:', e)
    }
  }

  function selectFileDiff(idx: number) {
    selectedFileDiffIndex.value = idx
    loadFileDiff(idx)
  }

  function selectFirstOrderedFileDiff() {
    const commit = selectedCommit.value
    if (!commit || commit.diffs.length === 0) return
    const firstFileIdx = firstOrderedFileDiffIndex(commit.diffs)
    selectFileDiff(firstFileIdx)
  }

  async function reloadSelectedFileDiff() {
    await loadFileDiff(selectedFileDiffIndex.value, true)
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

  async function deleteRemoteBranch(remoteName: string, branchName: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.deleteRemoteBranch(repoStore.activeRepoId, remoteName, branchName)
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

  async function checkoutCommit(oid: string, expectedHead?: string, expectedHeadRef?: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.checkoutCommit(repoStore.activeRepoId, oid, expectedHead, expectedHeadRef)
    // HEAD detached 后需要刷新分支列表和日志
    await Promise.all([loadLog(), loadBranches()])
  }

  async function cherryPickCommit(
    oid: string,
    expectedHead?: string,
    expectedHeadRef?: string,
  ) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.cherryPickCommit(repoStore.activeRepoId, oid, expectedHead, expectedHeadRef)
    await Promise.all([loadLog(), loadBranches()])
  }

  async function revertCommit(oid: string, expectedHead?: string, expectedHeadRef?: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.revertCommit(repoStore.activeRepoId, oid, expectedHead, expectedHeadRef)
    await Promise.all([loadLog(), loadBranches()])
  }

  async function resetToCommit(
    oid: string,
    mode: 'soft' | 'mixed' | 'hard',
    expectedHead?: string,
    expectedHeadRef?: string,
  ) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.resetToCommit(repoStore.activeRepoId, oid, mode, expectedHead, expectedHeadRef)
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

  async function deleteRemoteTag(tagName: string, remoteName: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.deleteRemoteTag(repoStore.activeRepoId, remoteName, tagName)
    // 重新加载远程标签列表以更新 UI 状态（是否已同步）
    await loadRemoteTags()
  }

  /// 并发查询所有 remote 的 tag 列表，合并成 set；失败的 remote 跳过。
  /// 至少一个 remote 成功即 remoteTagsChecked = true；全部失败（通常是无网络 / 认证错误）
  /// 保持 false，让前端显示"未知"态而不是误判成"仅本地"。
  async function loadRemoteTags(force = false) {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    if (remoteTagsLoading.value && remoteTagsLoadingRepoId === repoId && !force) return
    const requestSeq = ++remoteTagsRequestSeq
    remoteTagsLoading.value = true
    remoteTagsLoadingRepoId = repoId
    try {
      const remotes = await git.listRemotes(repoId).catch(() => [] as RemoteInfo[])
      if (requestSeq !== remoteTagsRequestSeq || !isActiveRepo(repoId)) return
      if (remotes.length === 0) {
        // 无 remote：认为已检查，所有 tag 都是"仅本地"
        remoteTagsChecked.value = true
        remoteTagNames.value = new Set()
        return
      }
      const results = await Promise.all(
        remotes.map(r =>
          git.listRemoteTags(repoId, r.name).then(
            tags => ({ ok: true as const, tags }),
            () => ({ ok: false as const, tags: [] as TagInfo[] }),
          ),
        ),
      )
      if (requestSeq !== remoteTagsRequestSeq || !isActiveRepo(repoId)) return
      const mergedNames = new Set<string>()
      const mergedTags: TagInfo[] = []
      let anySuccess = false
      for (const r of results) {
        if (r.ok) {
          anySuccess = true
          for (const t of r.tags) {
            if (!mergedNames.has(t.name)) {
              mergedNames.add(t.name)
              mergedTags.push(t)
            }
          }
        }
      }
      if (anySuccess) {
        remoteTagNames.value = mergedNames
        remoteTags.value = mergedTags
        remoteTagsChecked.value = true
      }
    } finally {
      if (requestSeq === remoteTagsRequestSeq) {
        remoteTagsLoading.value = false
        remoteTagsLoadingRepoId = null
      }
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

  function jumpAdjacentCommit(delta: -1 | 1) {
    if (commits.value.length === 0) return

    if (selectedWip.value) {
      if (delta > 0) pendingJumpOid.value = commits.value[0]?.oid ?? null
      return
    }

    const currentOid = selectedCommit.value?.info.oid ?? null
    const currentIndex = currentOid
      ? commits.value.findIndex((commit) => commit.oid === currentOid)
      : -1
    const nextIndex =
      currentIndex < 0
        ? 0
        : Math.max(0, Math.min(commits.value.length - 1, currentIndex + delta))

    const next = commits.value[nextIndex]
    if (!next || next.oid === currentOid) return
    pendingJumpOid.value = next.oid
  }

  function reset() {
    logRequestSeq++
    branchesRequestSeq++
    tagsRequestSeq++
    remoteTagsRequestSeq++
    commitDetailRequestSeq++
    fileDiffRequestSeq++
    commitSearchRequestSeq++
    remoteTagsLoadingRepoId = null
    commits.value = []
    branches.value = []
    remotes.value = []
    tags.value = []
    remoteTagNames.value = new Set()
    remoteTags.value = []
    remoteTagsChecked.value = false
    remoteTagsLoading.value = false
    selectedCommit.value = null
    selectedWip.value = false
    showDetail.value = false
    graphRows.value = []
    graphLaneState.value = null
    selectedFileDiffIndex.value = 0
    hasMore.value = false
    loading.value = false
    loadingMore.value = false
    loadingDetail.value = false
    error.value = null
    commitSearchResults.value = []
    commitSearchQuery.value = ''
    commitSearchHasMore.value = false
    commitSearchLoading.value = false
    commitSearchError.value = null
    pendingJumpOid.value = null
    pendingRevealOid.value = null
    commitChangeStatsRepoId.value = null
    clearCommitChangeStats()
  }

  return {
    commits,
    branches,
    remotes,
    tags,
    remoteTagNames,
    remoteTags,
    remoteTagsChecked,
    remoteTagsLoading,
    selectedCommit,
    selectedWip,
    showDetail,
    graphRows,
    commitChangeStats,
    commitChangeStatsLoading,
    commitChangeStatsFailed,
    selectedFileDiffIndex,
    loadingDetail,
    hasMore,
    loading,
    loadingMore,
    error,
    commitSearchResults,
    commitSearchQuery,
    commitSearchHasMore,
    commitSearchLoading,
    commitSearchError,
    pendingJumpOid,
    pendingRevealOid,
    loadLog,
    loadMore,
    searchCommits,
    cancelCommitSearch,
    ensureCommitLoaded,
    ensureCommitChangeStats,
    loadBranches,
    loadTags,
    loadRemoteTags,
    markTagPushed,
    jumpAdjacentCommit,
    selectCommit,
    selectFileDiff,
    reloadSelectedFileDiff,
    selectFirstOrderedFileDiff,
    createBranch,
    switchBranch,
    deleteBranch,
    deleteRemoteBranch,
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
    deleteRemoteTag,
    reset,
  }
})
