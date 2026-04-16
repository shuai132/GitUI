import { defineStore } from 'pinia'
import { ref } from 'vue'
import { LazyStore } from '@tauri-apps/plugin-store'
import type { RepoMeta, WorkspaceStatus } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'

// 持久化存储：记录打开过的仓库路径以及上次激活的路径
const STORE_FILE = 'gitui-repos.json'
const KEY_PATHS = 'paths'
const KEY_ACTIVE_PATH = 'activePath'

interface RepoViewState {
  selectedCommitOid: string | null
  selectedWip: boolean
  wipSelectedPath: string | null
  cachedWorkspaceStatus: WorkspaceStatus | null
}

export const useRepoStore = defineStore('repos', () => {
  const repos = ref<RepoMeta[]>([])
  const activeRepoId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const git = useGitCommands()
  const store = new LazyStore(STORE_FILE)

  const repoViewStates = new Map<string, RepoViewState>()

  function saveViewState(repoId: string, state: RepoViewState) {
    repoViewStates.set(repoId, state)
  }

  function getViewState(repoId: string): RepoViewState | undefined {
    return repoViewStates.get(repoId)
  }

  async function persist() {
    const paths = repos.value.map((r) => r.path)
    const activePath =
      repos.value.find((r) => r.id === activeRepoId.value)?.path ?? null
    await store.set(KEY_PATHS, paths)
    await store.set(KEY_ACTIVE_PATH, activePath)
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
      const rawPaths = (await store.get<string[]>(KEY_PATHS)) ?? []
      // 去重：历史持久化数据可能包含重复 path
      const paths = Array.from(new Set(rawPaths))
      const activePath = (await store.get<string | null>(KEY_ACTIVE_PATH)) ?? null

      let hasFailed = rawPaths.length !== paths.length // 去重本身算一次清理
      for (const path of paths) {
        try {
          const meta = await git.openRepo(path)
          // Pinia store 是单例，repos.value 不会因组件重新挂载而清空；
          // HMR / 重复触发 loadPersisted 时，这里能防止同一 path 被 push 两次
          if (repos.value.find((r) => r.path === path)) {
            hasFailed = true
            continue
          }
          repos.value.push(meta)
        } catch (e) {
          console.error(`Failed to restore repo "${path}":`, e)
          hasFailed = true
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

      // 有清理动作（去重或恢复失败）时把新列表回写
      if (hasFailed) {
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
      // 按 path 去重：相同路径已打开则直接激活，避免后端重复注册 watcher
      const existing = repos.value.find((r) => r.path === path)
      if (existing) {
        activeRepoId.value = existing.id
        await persist()
        return existing
      }

      const meta = await git.openRepo(path)
      repos.value.push(meta)
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

  /**
   * 克隆远程仓库。完成后统一走 openRepo 注册到后端 + 加入侧栏 + 激活，
   * 不在后端的 clone_repo 里直接注册 watcher，保持职责单一。
   */
  async function cloneRepo(opts: {
    url: string
    parentDir: string
    name?: string
    depth?: number
    recurseSubmodules: boolean
  }): Promise<RepoMeta> {
    const workdir = await git.cloneRepo(opts)
    return await openRepo(workdir)
  }

  /**
   * 在 path 下 `git init`，完成后 openRepo 激活。
   */
  async function initRepo(path: string): Promise<RepoMeta> {
    const workdir = await git.initRepo(path)
    return await openRepo(workdir)
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

  async function reorderRepos(fromIndex: number, toIndex: number) {
    const len = repos.value.length
    if (
      fromIndex === toIndex ||
      fromIndex < 0 || fromIndex >= len ||
      toIndex < 0 || toIndex >= len
    ) {
      return
    }
    const [moved] = repos.value.splice(fromIndex, 1)
    repos.value.splice(toIndex, 0, moved)
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
    cloneRepo,
    initRepo,
    closeRepo,
    setActive,
    reorderRepos,
    activeRepo,
    saveViewState,
    getViewState,
  }
})
