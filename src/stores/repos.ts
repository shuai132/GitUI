import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RepoMeta } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'

export const useRepoStore = defineStore('repos', () => {
  const repos = ref<RepoMeta[]>([])
  const activeRepoId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const git = useGitCommands()

  async function openRepo(path: string) {
    loading.value = true
    error.value = null
    try {
      const meta = await git.openRepo(path)
      if (!repos.value.find((r) => r.id === meta.id)) {
        repos.value.push(meta)
      }
      activeRepoId.value = meta.id
      return meta
    } catch (e: unknown) {
      error.value = String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function closeRepo(repoId: string) {
    await git.closeRepo(repoId)
    repos.value = repos.value.filter((r) => r.id !== repoId)
    if (activeRepoId.value === repoId) {
      activeRepoId.value = repos.value[0]?.id ?? null
    }
  }

  function setActive(repoId: string) {
    activeRepoId.value = repoId
  }

  const activeRepo = () => repos.value.find((r) => r.id === activeRepoId.value) ?? null

  return {
    repos,
    activeRepoId,
    loading,
    error,
    openRepo,
    closeRepo,
    setActive,
    activeRepo,
  }
})
