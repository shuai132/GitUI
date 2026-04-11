import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WorkspaceStatus, FileEntry } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'

export const useWorkspaceStore = defineStore('workspace', () => {
  const status = ref<WorkspaceStatus | null>(null)
  const selectedFile = ref<FileEntry | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const git = useGitCommands()

  async function refresh(repoId?: string) {
    const repoStore = useRepoStore()
    const id = repoId ?? repoStore.activeRepoId
    if (!id) return

    loading.value = true
    error.value = null
    try {
      status.value = await git.getStatus(id)
      // Clear selected file if it no longer exists
      if (selectedFile.value) {
        const allFiles = [
          ...(status.value?.staged ?? []),
          ...(status.value?.unstaged ?? []),
          ...(status.value?.untracked ?? []),
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
    if (!repoStore.activeRepoId) return
    await git.stageFile(repoStore.activeRepoId, filePath)
    await refresh()
  }

  async function unstageFile(filePath: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.unstageFile(repoStore.activeRepoId, filePath)
    await refresh()
  }

  async function stageAll() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.stageAll(repoStore.activeRepoId)
    await refresh()
  }

  async function unstageAll() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.unstageAll(repoStore.activeRepoId)
    await refresh()
  }

  async function commit(message: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    const oid = await git.createCommit(repoStore.activeRepoId, message)
    await refresh()
    return oid
  }

  async function amend(message: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    const oid = await git.amendCommit(repoStore.activeRepoId, message)
    await refresh()
    return oid
  }

  async function discardAll() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.discardAllChanges(repoStore.activeRepoId)
    await refresh()
  }

  async function discardFile(filePath: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.discardFile(repoStore.activeRepoId, filePath)
    await refresh()
  }

  function selectFile(file: FileEntry | null) {
    selectedFile.value = file
  }

  return {
    status,
    selectedFile,
    loading,
    error,
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
  }
})
