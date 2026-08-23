import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { WorkspaceStatus, FileEntry } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'
import { useMergeRebaseStore } from './mergeRebase'

export interface UndoCommitCandidate {
  repoId: string
  oid: string
  message: string
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const status = ref<WorkspaceStatus | null>(null)
  const selectedFile = ref<FileEntry | null>(null)
  const wipSelectedPath = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 当前提交信息草稿（WipPanel 输入框 ↔ 工具栏 Stash 共享）
  const commitDraft = ref('')
  const undoCommitCandidate = ref<UndoCommitCandidate | null>(null)

  const git = useGitCommands()
  let refreshSeq = 0

  // 切仓库时清空草稿，避免上一个仓库的提交信息泄漏到下一个仓库
  watch(
    () => useRepoStore().activeRepoId,
    () => {
      commitDraft.value = ''
      undoCommitCandidate.value = null
    },
  )

  async function refresh(repoId?: string) {
    const repoStore = useRepoStore()
    const id = repoId ?? repoStore.activeRepoId
    if (!id) return

    const requestSeq = ++refreshSeq
    loading.value = true
    error.value = null
    try {
      const result = await git.getStatus(id)
      // 丢弃过期响应：await 期间用户可能已切换到其他仓库，
      // 此时 id 与当前活跃仓库不符，写入会污染新仓库的 status。
      // 同一仓库的多次刷新也只允许最后一次写入，避免旧快照覆盖新快照。
      if (requestSeq !== refreshSeq || id !== repoStore.activeRepoId) return
      status.value = result
      if (
        undoCommitCandidate.value?.repoId === id &&
        result.head_commit !== undoCommitCandidate.value.oid
      ) {
        undoCommitCandidate.value = null
      }
      // 把后端顺带返回的 repo_state 同步到 mergeRebase store，供横幅/对话框消费
      useMergeRebaseStore().setRepoState(result.repo_state)
      // Clear selected file if it no longer exists
      if (selectedFile.value) {
        const allFiles = [
          ...(result.staged ?? []),
          ...(result.unstaged ?? []),
          ...(result.untracked ?? []),
        ]
        if (!allFiles.find((f) => f.path === selectedFile.value?.path)) {
          selectedFile.value = null
        }
      }
    } catch (e: unknown) {
      if (requestSeq === refreshSeq && id === repoStore.activeRepoId) {
        error.value = String(e)
      }
    } finally {
      if (requestSeq === refreshSeq) loading.value = false
    }
  }

  async function stageFile(filePath: string) {
    const repoStore = useRepoStore()
    const id = repoStore.activeRepoId
    if (!id) return
    await git.stageFile(id, filePath)
    await refresh(id)
  }

  async function unstageFile(filePath: string) {
    const repoStore = useRepoStore()
    const id = repoStore.activeRepoId
    if (!id) return
    await git.unstageFile(id, filePath)
    await refresh(id)
  }

  async function stageAll() {
    const repoStore = useRepoStore()
    const id = repoStore.activeRepoId
    if (!id) return
    await git.stageAll(id)
    await refresh(id)
  }

  async function unstageAll() {
    const repoStore = useRepoStore()
    const id = repoStore.activeRepoId
    if (!id) return
    await git.unstageAll(id)
    await refresh(id)
  }

  async function commit(message: string) {
    const repoStore = useRepoStore()
    const id = repoStore.activeRepoId
    if (!id) return
    const previousHead = status.value?.head_commit
    const oid = await git.createCommit(id, message)
    await refresh(id)
    undoCommitCandidate.value = previousHead && repoStore.activeRepoId === id
      ? { repoId: id, oid, message }
      : null
    return oid
  }

  async function amend(message: string) {
    const repoStore = useRepoStore()
    const id = repoStore.activeRepoId
    if (!id) return
    const oid = await git.amendCommit(id, message)
    await refresh(id)
    undoCommitCandidate.value = null
    return oid
  }

  async function undoLastCommit(): Promise<string | undefined> {
    const repoStore = useRepoStore()
    const candidate = undoCommitCandidate.value
    if (!candidate || candidate.repoId !== repoStore.activeRepoId) return

    await git.undoLastCommit(candidate.repoId, candidate.oid)
    undoCommitCandidate.value = null
    if (repoStore.activeRepoId === candidate.repoId && commitDraft.value.trim() === '') {
      commitDraft.value = candidate.message
    }
    await refresh(candidate.repoId)
    return candidate.repoId
  }

  function clearUndoCommitCandidate(repoId?: string) {
    if (repoId && undoCommitCandidate.value?.repoId !== repoId) return
    undoCommitCandidate.value = null
  }

  async function discardAll() {
    const repoStore = useRepoStore()
    const id = repoStore.activeRepoId
    if (!id) return
    await git.discardAllChanges(id)
    await refresh(id)
  }

  async function discardFile(filePath: string) {
    const repoStore = useRepoStore()
    const id = repoStore.activeRepoId
    if (!id) return
    await git.discardFile(id, filePath)
    await refresh(id)
  }

  function selectFile(file: FileEntry | null) {
    selectedFile.value = file
  }

  function reset(cachedStatus: WorkspaceStatus | null = null) {
    refreshSeq++
    status.value = cachedStatus
    selectedFile.value = null
    wipSelectedPath.value = null
    loading.value = false
    error.value = null
  }

  return {
    status,
    selectedFile,
    wipSelectedPath,
    loading,
    error,
    commitDraft,
    undoCommitCandidate,
    refresh,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    commit,
    amend,
    undoLastCommit,
    clearUndoCommitCandidate,
    discardAll,
    discardFile,
    selectFile,
    reset,
  }
})
