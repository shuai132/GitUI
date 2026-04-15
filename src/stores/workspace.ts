import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { WorkspaceStatus, FileEntry } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'

export const useWorkspaceStore = defineStore('workspace', () => {
  const status = ref<WorkspaceStatus | null>(null)
  const selectedFile = ref<FileEntry | null>(null)
  const wipSelectedPath = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 当前提交信息草稿（WipPanel 输入框 ↔ 工具栏 Stash 共享）
  const commitDraft = ref('')

  const git = useGitCommands()

  // 切仓库时清空草稿，避免上一个仓库的提交信息泄漏到下一个仓库
  watch(
    () => useRepoStore().activeRepoId,
    () => {
      commitDraft.value = ''
    },
  )

  async function refresh(repoId?: string) {
    const repoStore = useRepoStore()
    const id = repoId ?? repoStore.activeRepoId
    if (!id) return

    loading.value = true
    error.value = null
    try {
      const result = await git.getStatus(id)
      // 丢弃过期响应：await 期间用户可能已切换到其他仓库，
      // 此时 id 与当前活跃仓库不符，写入会污染新仓库的 status
      if (id !== repoStore.activeRepoId) return
      status.value = result
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
      error.value = String(e)
    } finally {
      loading.value = false
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
    const oid = await git.createCommit(id, message)
    await refresh(id)
    return oid
  }

  async function amend(message: string) {
    const repoStore = useRepoStore()
    const id = repoStore.activeRepoId
    if (!id) return
    const oid = await git.amendCommit(id, message)
    await refresh(id)
    return oid
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

  function reset() {
    status.value = null
    selectedFile.value = null
    wipSelectedPath.value = null
  }

  return {
    status,
    selectedFile,
    wipSelectedPath,
    loading,
    error,
    commitDraft,
    refresh,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    commit,
    amend,
    discardAll,
    discardFile,
    selectFile,
    reset,
  }
})
