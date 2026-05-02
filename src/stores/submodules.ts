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
  let loadSeq = 0

  async function loadSubmodules() {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) {
      submodules.value = []
      return
    }
    const requestSeq = ++loadSeq
    loading.value = true
    error.value = null
    try {
      const next = await git.listSubmodules(repoId)
      if (requestSeq !== loadSeq || repoStore.activeRepoId !== repoId) return
      submodules.value = next
    } catch (e: unknown) {
      if (requestSeq === loadSeq && repoStore.activeRepoId === repoId) {
        error.value = String(e)
        submodules.value = []
      }
    } finally {
      if (requestSeq === loadSeq) loading.value = false
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
    loadSeq++
    submodules.value = []
    loading.value = false
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
