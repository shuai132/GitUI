import { defineStore } from 'pinia'
import { ref } from 'vue'
import { LazyStore } from '@tauri-apps/plugin-store'
import type { RepoMeta } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'

// 持久化存储：记录打开过的仓库路径以及上次激活的路径
const STORE_FILE = 'gitui-repos.json'
const KEY_PATHS = 'paths'
const KEY_ACTIVE_PATH = 'activePath'

interface PersistedState {
  paths: string[]
  activePath: string | null
}

export const useRepoStore = defineStore('repos', () => {
  const repos = ref<RepoMeta[]>([])
  const activeRepoId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const git = useGitCommands()
  const store = new LazyStore(STORE_FILE)

  async function persist() {
    const state: PersistedState = {
      paths: repos.value.map((r) => r.path),
      activePath:
        repos.value.find((r) => r.id === activeRepoId.value)?.path ?? null,
    }
    await store.set(KEY_PATHS, state.paths)
    await store.set(KEY_ACTIVE_PATH, state.activePath)
    await store.save()
  }

  /**
   * 启动时从持久化存储恢复仓库列表，依次调用后端 open_repo 重新注册。
   * 后端 RepoManager 是内存态，所以每次启动都要重新 open 才能让后续命令工作。
   */
  async function loadPersisted() {
    loading.value = true
    error.value = null
    try {
      const paths = (await store.get<string[]>(KEY_PATHS)) ?? []
      const activePath = (await store.get<string | null>(KEY_ACTIVE_PATH)) ?? null

      const failed: string[] = []
      for (const path of paths) {
        try {
          const meta = await git.openRepo(path)
          if (!repos.value.find((r) => r.id === meta.id)) {
            repos.value.push(meta)
          }
        } catch (e) {
          console.error(`Failed to restore repo "${path}":`, e)
          failed.push(path)
        }
      }

      // 恢复激活仓库
      if (activePath) {
        const active = repos.value.find((r) => r.path === activePath)
        if (active) {
          activeRepoId.value = active.id
        } else if (repos.value.length > 0) {
          activeRepoId.value = repos.value[0].id
        }
      } else if (repos.value.length > 0) {
        activeRepoId.value = repos.value[0].id
      }

      // 有仓库恢复失败（例如路径已被删除），把新列表回写以清理脏数据
      if (failed.length > 0) {
        await persist()
      }
    } catch (e: unknown) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  async function openRepo(path: string) {
    loading.value = true
    error.value = null
    try {
      const meta = await git.openRepo(path)
      if (!repos.value.find((r) => r.id === meta.id)) {
        repos.value.push(meta)
      }
      activeRepoId.value = meta.id
      await persist()
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
    await persist()
  }

  async function setActive(repoId: string) {
    activeRepoId.value = repoId
    await persist()
  }

  const activeRepo = () => repos.value.find((r) => r.id === activeRepoId.value) ?? null

  return {
    repos,
    activeRepoId,
    loading,
    error,
    loadPersisted,
    openRepo,
    closeRepo,
    setActive,
    activeRepo,
  }
})
