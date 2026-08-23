import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { WorkspaceStatus, FileEntry } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'
import { useMergeRebaseStore } from './mergeRebase'

const COMMIT_DRAFT_KEY_PREFIX = 'gitui.workspace.commitDraft:'

function loadCommitDraft(repoPath: string): string {
  try {
    const draft = localStorage.getItem(`${COMMIT_DRAFT_KEY_PREFIX}${repoPath}`) ?? ''
    return draft.trim().length > 0 ? draft : ''
  } catch {
    return ''
  }
}

function persistCommitDraft(repoPath: string, draft: string) {
  try {
    const key = `${COMMIT_DRAFT_KEY_PREFIX}${repoPath}`
    if (draft.trim().length === 0) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, draft)
    }
  } catch {
    // 草稿仍保留在当前 Pinia store；存储不可用时不阻断输入和提交。
  }
}

export interface UndoCommitCandidate {
  repoId: string
  oid: string
  message: string
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const repoStore = useRepoStore()
  const commitDrafts = new Map<string, string>()

  function getCommitDraft(repoPath: string): string {
    const cached = commitDrafts.get(repoPath)
    if (cached !== undefined) return cached
    const stored = loadCommitDraft(repoPath)
    if (stored) commitDrafts.set(repoPath, stored)
    return stored
  }

  const status = ref<WorkspaceStatus | null>(null)
  const selectedFile = ref<FileEntry | null>(null)
  const wipSelectedPath = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 当前提交信息草稿（WipPanel 输入框 ↔ 工具栏 Stash 共享），按仓库路径隔离。
  const initialRepoPath = repoStore.activeRepo()?.path
  const commitDraft = ref(initialRepoPath ? getCommitDraft(initialRepoPath) : '')
  const undoCommitCandidate = ref<UndoCommitCandidate | null>(null)

  const git = useGitCommands()
  let refreshSeq = 0

  function saveCommitDraft(repoPath: string, draft: string) {
    if (draft.trim().length > 0) {
      commitDrafts.set(repoPath, draft)
    } else {
      commitDrafts.delete(repoPath)
    }
    persistCommitDraft(repoPath, draft)
  }

  function clearCommitDraftIfUnchanged(repoPath: string, expectedDraft: string) {
    if (getCommitDraft(repoPath) !== expectedDraft) return
    commitDrafts.delete(repoPath)
    persistCommitDraft(repoPath, '')
    if (repoStore.activeRepo()?.path === repoPath && commitDraft.value === expectedDraft) {
      commitDraft.value = ''
    }
  }

  watch(
    commitDraft,
    (draft) => {
      const repoPath = repoStore.activeRepo()?.path
      if (repoPath) saveCommitDraft(repoPath, draft)
    },
    { flush: 'sync' },
  )

  // 切仓库时先落盘旧仓库草稿，再恢复新仓库自己的输入。
  watch(
    () => repoStore.activeRepo()?.path ?? null,
    (repoPath, previousRepoPath) => {
      if (previousRepoPath) saveCommitDraft(previousRepoPath, commitDraft.value)
      commitDraft.value = repoPath ? getCommitDraft(repoPath) : ''
      undoCommitCandidate.value = null
    },
    { flush: 'sync' },
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
    const repoPath = repoStore.activeRepo()?.path
    const submittedDraft = commitDraft.value
    const previousHead = status.value?.head_commit
    const oid = await git.createCommit(id, message)
    if (repoPath && submittedDraft.trim() === message.trim()) {
      clearCommitDraftIfUnchanged(repoPath, submittedDraft)
    }
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
    const repoPath = repoStore.activeRepo()?.path
    const submittedDraft = commitDraft.value
    const oid = await git.amendCommit(id, message)
    if (repoPath && submittedDraft.trim() === message.trim()) {
      clearCommitDraftIfUnchanged(repoPath, submittedDraft)
    }
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
    clearCommitDraftIfUnchanged,
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
