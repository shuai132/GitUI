import { computed, reactive, type Ref } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'
import type { ContextMenuItem } from '@/components/common/ContextMenu.vue'
import type { ContextMenuPayload } from '@/components/workspace/FileChangeList.vue'
import type { useGitCommands } from '@/composables/useGitCommands'
import type { useMergeRebaseStore } from '@/stores/mergeRebase'
import type { useRepoStore } from '@/stores/repos'
import { resolveExternalTerminalApp, type useSettingsStore } from '@/stores/settings'
import type { useWorkspaceStore } from '@/stores/workspace'
import type { FileEntry } from '@/types/git'

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
  selectedPath: Ref<string | null>
  unstagedMultiPaths: Ref<string[]>
  stagedMultiPaths: Ref<string[]>
  toggleFile: (fileOrPath: FileEntry | string, isDir: boolean) => Promise<void>
  batchStage: () => Promise<void>
  batchUnstage: () => Promise<void>
  batchDiscard: () => Promise<void>
  confirmDiscardFile: (filePath: string) => boolean
  showFileHistory: (payload: { filePath: string; mode: 'history' | 'blame' }) => void
}

export function useWipMenus(options: WipMenuOptions) {
  const {
    t,
    git,
    mergeRebaseStore,
    repoStore,
    settingsStore,
    workspaceStore,
    selectedPath,
    unstagedMultiPaths,
    stagedMultiPaths,
    toggleFile,
    batchStage,
    batchUnstage,
    batchDiscard,
    confirmDiscardFile,
    showFileHistory,
  } = options

  const batchMenu = reactive({
    visible: false,
    x: 0,
    y: 0,
    source: '' as 'unstaged' | 'staged',
  })

  const batchMenuItems = computed<ContextMenuItem[]>(() => {
    if (batchMenu.source === 'unstaged') {
      const n = unstagedMultiPaths.value.length
      return [
        { label: t('workspace.wip.menu.stageSelected', { count: n }), action: 'batch-stage' },
        { separator: true },
        { label: t('workspace.wip.menu.discardSelected', { count: n }), action: 'batch-discard', danger: true },
      ]
    }
    const n = stagedMultiPaths.value.length
    return [
      { label: t('workspace.wip.menu.unstageSelected', { count: n }), action: 'batch-unstage' },
    ]
  })

  const fileMenu = reactive({
    visible: false,
    x: 0,
    y: 0,
    file: null as FileEntry | null,
    path: '',
    isDir: false,
  })

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
    if (f.status === 'conflicted') {
      return [
        { label: t('workspace.wip.menu.useOurs'), action: 'use-ours' },
        { label: t('workspace.wip.menu.useTheirs'), action: 'use-theirs' },
        { separator: true },
        { label: t('workspace.wip.menu.markResolved'), action: 'mark-resolved' },
        { separator: true },
        { label: t('workspace.wip.menu.copyRelativePath'), action: 'copy-relative' },
        { label: t('workspace.wip.menu.openInEditor'), action: 'open-editor' },
      ]
    }
    return [
      {
        label: f.staged ? t('workspace.wip.menu.unstage') : t('workspace.wip.menu.stage'),
        action: 'toggle',
      },
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
    ]
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
    fileMenu.x = e.clientX
    fileMenu.y = e.clientY
    fileMenu.visible = true
  }

  async function handleBatchMenuAction(action: string) {
    batchMenu.visible = false
    if (action === 'batch-stage') await batchStage()
    else if (action === 'batch-unstage') await batchUnstage()
    else if (action === 'batch-discard') await batchDiscard()
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
      if (action === 'use-ours') {
        await mergeRebaseStore.useConflictSide(targetPath, 'ours')
      } else if (action === 'use-theirs') {
        await mergeRebaseStore.useConflictSide(targetPath, 'theirs')
      } else if (action === 'mark-resolved') {
        const content = await git.readWorktreeFile(repoStore.activeRepoId!, targetPath, true)
          .then((b) => {
            const binary = atob(b.bytes_base64)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            return new TextDecoder().decode(bytes)
          })
          .catch(() => '')
        await mergeRebaseStore.resolveConflict(targetPath, content)
      } else if (action === 'toggle') {
        await toggleFile(isDir ? targetPath : f!, isDir)
      } else if (action === 'copy-name') {
        await navigator.clipboard.writeText(targetPath.split('/').pop() ?? targetPath)
      } else if (action === 'copy-relative') {
        await navigator.clipboard.writeText(targetPath)
      } else if (action === 'copy-absolute') {
        await navigator.clipboard.writeText(absPath)
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
        if (!confirmDiscardFile(targetPath)) return
        await workspaceStore.discardFile(targetPath)
        if (selectedPath.value === targetPath) {
          selectedPath.value = null
        }
      } else if (action === 'file-history') {
        showFileHistory({ filePath: targetPath, mode: 'history' })
      } else if (action === 'file-blame') {
        showFileHistory({ filePath: targetPath, mode: 'blame' })
      }
    } catch (e) {
      alert(String(e))
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
