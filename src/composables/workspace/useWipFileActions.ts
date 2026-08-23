import type { ComputedRef, Ref } from 'vue'
import type FileChangeList from '@/components/workspace/FileChangeList.vue'
import type { useWorkspaceStore } from '@/stores/workspace'
import type { FileEntry } from '@/types/git'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

type WipFileActionsOptions = {
  workspaceStore: WorkspaceStore
  selectedPath: Ref<string | null>
  unstagedAll: ComputedRef<FileEntry[]>
  stagedAll: ComputedRef<FileEntry[]>
  unstagedMultiPaths: Ref<string[]>
  stagedMultiPaths: Ref<string[]>
  unstagedListRef: Ref<InstanceType<typeof FileChangeList> | null>
  stagedListRef: Ref<InstanceType<typeof FileChangeList> | null>
  confirmDiscardSelected: (count: number) => boolean
}

export function useWipFileActions(options: WipFileActionsOptions) {
  const {
    workspaceStore,
    selectedPath,
    unstagedAll,
    stagedAll,
    unstagedMultiPaths,
    stagedMultiPaths,
    unstagedListRef,
    stagedListRef,
    confirmDiscardSelected,
  } = options

  async function toggleFile(fileOrPath: FileEntry | string, isDir: boolean) {
    if (isDir) {
      const dirPath = fileOrPath as string
      const prefix = dirPath + '/'
      const toStage = unstagedAll.value.filter((f) => f.path.startsWith(prefix))
      if (toStage.length > 0) {
        await workspaceStore.stageFiles(toStage.map((file) => file.path))
      } else {
        const toUnstage = stagedAll.value.filter((f) => f.path.startsWith(prefix))
        await workspaceStore.unstageFiles(toUnstage.map((file) => file.path))
      }
      return
    }

    const file = fileOrPath as FileEntry
    if (file.staged) {
      await workspaceStore.unstageFile(file.path)
    } else {
      await workspaceStore.stageFile(file.path)
    }
  }

  async function stageAll() {
    await workspaceStore.stageAll()
  }

  async function unstageAll() {
    await workspaceStore.unstageAll()
  }

  async function batchStage() {
    const paths = [...unstagedMultiPaths.value]
    await workspaceStore.stageFiles(paths)
    unstagedListRef.value?.clearMultiSelect()
    unstagedMultiPaths.value = []
  }

  async function batchUnstage() {
    const paths = [...stagedMultiPaths.value]
    await workspaceStore.unstageFiles(paths)
    stagedListRef.value?.clearMultiSelect()
    stagedMultiPaths.value = []
  }

  async function batchDiscard() {
    const paths = [...unstagedMultiPaths.value]
    if (!confirmDiscardSelected(paths.length)) return
    await workspaceStore.discardFiles(paths)
    if (paths.includes(selectedPath.value ?? '')) {
      selectedPath.value = null
    }
    unstagedListRef.value?.clearMultiSelect()
    unstagedMultiPaths.value = []
  }

  return {
    toggleFile,
    stageAll,
    unstageAll,
    batchStage,
    batchUnstage,
    batchDiscard,
  }
}
