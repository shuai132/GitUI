import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SubmoduleInfo } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'

export const useSubmodulesStore = defineStore('submodules', () => {
  const submodules = ref<SubmoduleInfo[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const git = useGitCommands()

  async function loadSubmodules() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) {
      submodules.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      submodules.value = await git.listSubmodules(repoStore.activeRepoId)
    } catch (e: unknown) {
      error.value = String(e)
      submodules.value = []
    } finally {
      loading.value = false
    }
  }

  async function init(name: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.initSubmodule(repoStore.activeRepoId, name)
    await loadSubmodules()
  }

  async function update(name: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.updateSubmodule(repoStore.activeRepoId, name)
    await loadSubmodules()
  }

  async function setUrl(name: string, url: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.setSubmoduleUrl(repoStore.activeRepoId, name, url)
    await loadSubmodules()
  }

  async function workdir(name: string): Promise<string> {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) throw new Error('No active repo')
    return await git.submoduleWorkdir(repoStore.activeRepoId, name)
  }

  async function deinit(name: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.deinitSubmodule(repoStore.activeRepoId, name)
    await loadSubmodules()
  }

  function reset() {
    submodules.value = []
    error.value = null
  }

  return {
    submodules,
    loading,
    error,
    loadSubmodules,
    init,
    update,
    setUrl,
    workdir,
    deinit,
    reset,
  }
})
