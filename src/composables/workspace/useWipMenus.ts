import { computed, reactive, type ComputedRef, type Ref } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'
import type { ContextMenuItem } from '@/components/common/ContextMenu.vue'
import type { ContextMenuPayload } from '@/components/workspace/FileChangeList.vue'
import type { useGitCommands } from '@/composables/useGitCommands'
import type { useMergeRebaseStore } from '@/stores/mergeRebase'
import type { useRepoStore } from '@/stores/repos'
import { resolveExternalTerminalApp, type useSettingsStore } from '@/stores/settings'
import type { useWorkspaceStore } from '@/stores/workspace'
import type { FileEntry, SubmoduleInfo } from '@/types/git'
import type { FileOrderPlacement } from '@/utils/fileOrderPrefs'
import { canOpenSubmodule, findSubmoduleByPath, submoduleSetupAction } from '@/utils/submodules'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useGlobalToast } from '@/composables/useGlobalToast'

type GitCommands = ReturnType<typeof useGitCommands>
type MergeRebaseStore = ReturnType<typeof useMergeRebaseStore>
type RepoStore = ReturnType<typeof useRepoStore>
type SettingsStore = ReturnType<typeof useSettingsStore>
type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

type WipMenuOptions = {
  t: ComposerTranslation
  git: GitCommands
  mergeRebaseStore: MergeRebaseStore
  repoStore: RepoStore
  settingsStore: SettingsStore
  workspaceStore: WorkspaceStore
  submodules: ComputedRef<SubmoduleInfo[]>
  viewMode: Ref<'list' | 'tree'>
  selectedPath: Ref<string | null>
  unstagedMultiPaths: Ref<string[]>
  stagedMultiPaths: Ref<string[]>
  toggleFile: (fileOrPath: FileEntry | string, isDir: boolean) => Promise<void>
  batchStage: () => Promise<void>
  batchUnstage: () => Promise<void>
  batchDiscard: () => void
  orderedBatchPaths: (source: 'unstaged' | 'staged') => string[]
  moveFileOrder: (paths: readonly string[], placement: FileOrderPlacement) => void
  requestDiscardFile: (filePath: string) => void
  openSubmodule: (submodule: SubmoduleInfo) => Promise<void>
  initSubmodule: (submodule: SubmoduleInfo) => Promise<void>
  updateSubmodule: (submodule: SubmoduleInfo) => Promise<void>
  showFileHistory: (payload: { filePath: string; mode: 'history' | 'blame' }) => void
}

export function useWipMenus(options: WipMenuOptions) {
  const { showActionError } = useGlobalToast()
  const {
    t,
    git,
    mergeRebaseStore,
    repoStore,
    settingsStore,
    workspaceStore,
    submodules,
    viewMode,
    selectedPath,
    unstagedMultiPaths,
    stagedMultiPaths,
    toggleFile,
    batchStage,
    batchUnstage,
    batchDiscard,
    orderedBatchPaths,
    moveFileOrder,
    requestDiscardFile,
    openSubmodule,
    initSubmodule,
    updateSubmodule,
    showFileHistory,
  } = options
  const { copyText } = useClipboardFeedback(t)

  const batchMenu = reactive({
    visible: false,
    x: 0,
    y: 0,
    source: '' as 'unstaged' | 'staged',
  })

  const batchMenuItems = computed<ContextMenuItem[]>(() => {
    const orderItems = viewMode.value === 'list'
      ? [
          { separator: true },
          { label: t('workspace.wip.menu.moveSelectedToFront', { count: batchMenu.source === 'unstaged' ? unstagedMultiPaths.value.length : stagedMultiPaths.value.length }), action: 'batch-move-front' },
          { label: t('workspace.wip.menu.moveSelectedToBack', { count: batchMenu.source === 'unstaged' ? unstagedMultiPaths.value.length : stagedMultiPaths.value.length }), action: 'batch-move-back' },
          { label: t('workspace.wip.menu.restoreSelectedOrder', { count: batchMenu.source === 'unstaged' ? unstagedMultiPaths.value.length : stagedMultiPaths.value.length }), action: 'batch-restore-order' },
        ] satisfies ContextMenuItem[]
      : []
    if (batchMenu.source === 'unstaged') {
      const n = unstagedMultiPaths.value.length
      return [
        { label: t('workspace.wip.menu.stageSelected', { count: n }), action: 'batch-stage' },
        { separator: true },
        { label: t('workspace.wip.menu.discardSelected', { count: n }), action: 'batch-discard', danger: true },
        ...orderItems,
      ]
    }
    const n = stagedMultiPaths.value.length
    return [
      { label: t('workspace.wip.menu.unstageSelected', { count: n }), action: 'batch-unstage' },
      ...orderItems,
    ]
  })

  const fileMenu = reactive({
    visible: false,
    x: 0,
    y: 0,
    repoId: null as string | null,
    file: null as FileEntry | null,
    path: '',
    isDir: false,
  })

  function openSubmoduleMenuItem(submodule: SubmoduleInfo | undefined): ContextMenuItem | null {
    if (!submodule) return null
    if (canOpenSubmodule(submodule)) {
      return {
        label: t('workspace.wip.menu.openSubmodule'),
        action: 'open-submodule',
      }
    }
    const setupAction = submoduleSetupAction(submodule)
    if (setupAction) {
      return {
        label: setupAction === 'init-submodule'
          ? t('workspace.wip.menu.initSubmodule')
          : t('workspace.wip.menu.updateSubmodule'),
        action: setupAction,
      }
    }
    return {
      label: t('workspace.wip.menu.openSubmodule'),
      action: 'open-submodule',
      disabled: true,
      title: t('workspace.wip.menu.openSubmoduleDisabled'),
    }
  }

  function orderMenuItems(): ContextMenuItem[] {
    if (viewMode.value !== 'list') return []
    return [
      { separator: true },
      { label: t('workspace.wip.menu.moveToFront'), action: 'move-front' },
      { label: t('workspace.wip.menu.moveToBack'), action: 'move-back' },
      { label: t('workspace.wip.menu.restoreOrder'), action: 'restore-order' },
    ]
  }

  const fileMenuItems = computed<ContextMenuItem[]>(() => {
    if (fileMenu.isDir) {
      return [
        { label: t('workspace.fileList.rowAction.stage'), action: 'toggle' },
        { separator: true },
        { label: t('workspace.wip.menu.copyRelativePath'), action: 'copy-relative' },
        { label: t('workspace.wip.menu.copyAbsolutePath'), action: 'copy-absolute' },
        { separator: true },
        { label: t('workspace.wip.menu.revealInFinder'), action: 'reveal' },
        { label: t('workspace.wip.menu.openTerminalHere'), action: 'open-terminal' },
        { separator: true },
        { label: t('fileHistory.menu.history'), action: 'file-history' },
      ]
    }

    const f = fileMenu.file
    if (!f) return []
    const submodule = findSubmoduleByPath(submodules.value, f.path)
    const submoduleItem = openSubmoduleMenuItem(submodule)
    if (f.status === 'conflicted') {
      const items: ContextMenuItem[] = []
      if (submoduleItem) {
        items.push(submoduleItem, { separator: true })
      }
      items.push(
        { label: t('workspace.wip.menu.useOurs'), action: 'use-ours' },
        { label: t('workspace.wip.menu.useTheirs'), action: 'use-theirs' },
        { separator: true },
        { label: t('workspace.wip.menu.markResolved'), action: 'mark-resolved' },
        { separator: true },
        { label: t('workspace.wip.menu.copyRelativePath'), action: 'copy-relative' },
        { label: t('workspace.wip.menu.openInEditor'), action: 'open-editor' },
        ...orderMenuItems(),
      )
      return items
    }
    const items: ContextMenuItem[] = [
      {
        label: f.staged ? t('workspace.wip.menu.unstage') : t('workspace.wip.menu.stage'),
        action: 'toggle',
      },
    ]
    if (submoduleItem) {
      items.push(submoduleItem)
    }
    items.push(
      { separator: true },
      { label: t('workspace.wip.menu.copyName'), action: 'copy-name' },
      { label: t('workspace.wip.menu.copyRelativePath'), action: 'copy-relative' },
      { label: t('workspace.wip.menu.copyAbsolutePath'), action: 'copy-absolute' },
      { separator: true },
      { label: t('workspace.wip.menu.revealInFinder'), action: 'reveal' },
      { label: t('workspace.wip.menu.openInEditor'), action: 'open-editor' },
      { label: t('workspace.wip.menu.openTerminalHere'), action: 'open-terminal' },
      { separator: true },
      {
        label: t('workspace.wip.menu.addToGitignore'),
        action: 'add-gitignore',
        disabled: f.staged || f.status !== 'untracked',
      },
      { separator: true },
      {
        label: t('workspace.wip.menu.discardFile'),
        action: 'discard',
        danger: true,
        disabled: f.staged,
      },
      { separator: true },
      { label: t('fileHistory.menu.history'), action: 'file-history', disabled: f.status === 'untracked' },
      { label: t('fileHistory.menu.blame'), action: 'file-blame', disabled: f.status === 'untracked' || f.status === 'deleted' },
      ...orderMenuItems(),
    )
    return items
  })

  function openFileContextMenu(e: MouseEvent, payload: ContextMenuPayload) {
    const inUnstagedMulti = !payload.isDir && unstagedMultiPaths.value.length > 1 &&
      unstagedMultiPaths.value.includes(payload.path)
    const inStagedMulti = !payload.isDir && stagedMultiPaths.value.length > 1 &&
      stagedMultiPaths.value.includes(payload.path)
    if (inUnstagedMulti || inStagedMulti) {
      batchMenu.source = inUnstagedMulti ? 'unstaged' : 'staged'
      batchMenu.x = e.clientX
      batchMenu.y = e.clientY
      batchMenu.visible = true
      return
    }

    fileMenu.file = payload.file ?? null
    fileMenu.path = payload.path
    fileMenu.isDir = payload.isDir
    fileMenu.repoId = repoStore.activeRepoId
    fileMenu.x = e.clientX
    fileMenu.y = e.clientY
    fileMenu.visible = true
  }

  async function handleBatchMenuAction(action: string) {
    batchMenu.visible = false
    if (action === 'batch-stage') await batchStage()
    else if (action === 'batch-unstage') await batchUnstage()
    else if (action === 'batch-discard') await batchDiscard()
    else if (action === 'batch-move-front') moveFileOrder(orderedBatchPaths(batchMenu.source), 'front')
    else if (action === 'batch-move-back') moveFileOrder(orderedBatchPaths(batchMenu.source), 'back')
    else if (action === 'batch-restore-order') moveFileOrder(orderedBatchPaths(batchMenu.source), 'default')
  }

  async function handleFileMenuAction(action: string) {
    const isDir = fileMenu.isDir
    const f = fileMenu.file
    const targetPath = fileMenu.path
    if (!f && !isDir) return
    fileMenu.visible = false

    const repoPath = repoStore.activeRepo()?.path ?? ''
    const absPath = repoPath ? `${repoPath}/${targetPath}` : targetPath
    const dirPath = isDir ? absPath : (absPath.substring(0, absPath.lastIndexOf('/')) || repoPath)

    try {
      if (action === 'use-ours' || action === 'use-theirs' || action === 'mark-resolved') {
        const repoId = fileMenu.repoId
        if (!repoId || repoStore.activeRepoId !== repoId) {
          throw new Error(t('conflict.view.contextChanged'))
        }
        const conflict = await mergeRebaseStore.loadConflictFile(repoId, targetPath)
        if (repoStore.activeRepoId !== repoId) {
          throw new Error(t('conflict.view.contextChanged'))
        }
        if (action === 'use-ours' || action === 'use-theirs') {
          await mergeRebaseStore.useConflictSide(
            repoId,
            conflict,
            action === 'use-ours' ? 'ours' : 'theirs',
          )
        } else {
          const content = await git.readWorktreeFile(repoId, targetPath, true)
            .then((b) => {
              const binary = atob(b.bytes_base64)
              const bytes = new Uint8Array(binary.length)
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
              return new TextDecoder().decode(bytes)
            })
          if (repoStore.activeRepoId !== repoId) {
            throw new Error(t('conflict.view.contextChanged'))
          }
          await mergeRebaseStore.resolveConflict(repoId, conflict, content)
        }
      } else if (action === 'toggle') {
        await toggleFile(isDir ? targetPath : f!, isDir)
      } else if (action === 'move-front') {
        moveFileOrder([targetPath], 'front')
      } else if (action === 'move-back') {
        moveFileOrder([targetPath], 'back')
      } else if (action === 'restore-order') {
        moveFileOrder([targetPath], 'default')
      } else if (action === 'open-submodule') {
        const submodule = findSubmoduleByPath(submodules.value, targetPath)
        if (canOpenSubmodule(submodule)) {
          await openSubmodule(submodule)
        }
      } else if (action === 'init-submodule') {
        const submodule = findSubmoduleByPath(submodules.value, targetPath)
        if (submodule && submoduleSetupAction(submodule) === 'init-submodule') {
          await initSubmodule(submodule)
        }
      } else if (action === 'update-submodule') {
        const submodule = findSubmoduleByPath(submodules.value, targetPath)
        if (submodule && submoduleSetupAction(submodule) === 'update-submodule') {
          await updateSubmodule(submodule)
        }
      } else if (action === 'copy-name') {
        await copyText(targetPath.split('/').pop() ?? targetPath)
      } else if (action === 'copy-relative') {
        await copyText(targetPath)
      } else if (action === 'copy-absolute') {
        await copyText(absPath)
      } else if (action === 'reveal') {
        await git.revealFile(absPath)
      } else if (action === 'open-editor') {
        await git.openFileInEditor(absPath)
      } else if (action === 'open-terminal') {
        await git.openTerminalHere(dirPath, resolveExternalTerminalApp(settingsStore))
      } else if (action === 'add-gitignore') {
        const repoId = repoStore.activeRepoId
        if (repoId) {
          await git.addToGitignore(repoId, targetPath)
          await workspaceStore.refresh(repoId)
        }
      } else if (action === 'discard') {
        requestDiscardFile(targetPath)
      } else if (action === 'file-history') {
        showFileHistory({ filePath: targetPath, mode: 'history' })
      } else if (action === 'file-blame') {
        showFileHistory({ filePath: targetPath, mode: 'blame' })
      }
    } catch (e) {
      showActionError(e)
    }
  }

  return {
    batchMenu,
    batchMenuItems,
    fileMenu,
    fileMenuItems,
    openFileContextMenu,
    handleBatchMenuAction,
    handleFileMenuAction,
  }
}
