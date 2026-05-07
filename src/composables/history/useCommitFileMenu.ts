import { computed, reactive, type ComputedRef, type Ref } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'
import type { ContextMenuItem } from '@/components/common/ContextMenu.vue'
import type { useGitCommands } from '@/composables/useGitCommands'
import type { useRepoStore } from '@/stores/repos'
import type { useWorkspaceStore } from '@/stores/workspace'
import type { FileDiff, SubmoduleInfo } from '@/types/git'

type GitCommands = ReturnType<typeof useGitCommands>
type RepoStore = ReturnType<typeof useRepoStore>
type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

type CommitFileMenuOptions = {
  t: ComposerTranslation
  git: GitCommands
  repoStore: RepoStore
  workspaceStore: WorkspaceStore
  submodules: ComputedRef<SubmoduleInfo[]>
  diffs: Ref<FileDiff[]>
  commitOid: Ref<string | undefined>
  openSubmodule: (submodule: SubmoduleInfo) => Promise<void>
  showFileHistory: (payload: { filePath: string; mode: 'history' | 'blame' }) => void
}

function diffPath(diff: FileDiff): string {
  return diff.new_path ?? diff.old_path ?? ''
}

export function useCommitFileMenu(options: CommitFileMenuOptions) {
  const {
    t,
    git,
    repoStore,
    workspaceStore,
    submodules,
    diffs,
    commitOid,
    openSubmodule,
    showFileHistory,
  } = options

  const fileMenu = reactive({
    visible: false,
    x: 0,
    y: 0,
    diffIdx: -1,
  })

  function submoduleForDiff(diff: FileDiff): SubmoduleInfo | undefined {
    return submodules.value.find((submodule) =>
      submodule.path === diff.new_path || submodule.path === diff.old_path
    )
  }

  function canOpenSubmodule(submodule: SubmoduleInfo | undefined): submodule is SubmoduleInfo {
    return !!submodule &&
      submodule.state !== 'uninitialized' &&
      submodule.state !== 'not_cloned' &&
      submodule.state !== 'not_found'
  }

  const fileMenuItems = computed<ContextMenuItem[]>(() => {
    const diff = diffs.value[fileMenu.diffIdx]
    if (!diff) return []

    const isDeleted = !diff.new_blob_oid && !!diff.old_blob_oid
    const submodule = submoduleForDiff(diff)
    const items: ContextMenuItem[] = [
      { label: t('history.fileMenu.copyName'), action: 'copy-name' },
      { label: t('history.fileMenu.copyRelativePath'), action: 'copy-relative' },
      { label: t('history.fileMenu.copyAbsolutePath'), action: 'copy-absolute' },
      { separator: true },
      { label: t('history.fileMenu.revealInFinder'), action: 'reveal', disabled: isDeleted },
      { label: t('history.fileMenu.openInEditor'), action: 'open-editor', disabled: isDeleted },
    ]
    if (submodule) {
      const disabled = !canOpenSubmodule(submodule)
      items.push({
        label: t('history.fileMenu.openSubmodule'),
        action: 'open-submodule',
        disabled,
        title: disabled ? t('history.fileMenu.openSubmoduleDisabled') : undefined,
      })
    }
    items.push(
      { separator: true },
      { label: t('history.fileMenu.checkoutFileVersion'), action: 'checkout-file', disabled: isDeleted },
      { separator: true },
      { label: t('fileHistory.menu.history'), action: 'file-history' },
      { label: t('fileHistory.menu.blame'), action: 'file-blame', disabled: isDeleted },
    )
    return items
  })

  function openFileMenu(event: MouseEvent, diffIdx: number) {
    event.preventDefault()
    fileMenu.diffIdx = diffIdx
    fileMenu.x = event.clientX
    fileMenu.y = event.clientY
    fileMenu.visible = true
  }

  async function handleFileMenuAction(action: string) {
    const diff = diffs.value[fileMenu.diffIdx]
    if (!diff) return
    fileMenu.visible = false

    const filePath = diffPath(diff)
    const repoPath = repoStore.activeRepo()?.path ?? ''
    const absPath = repoPath ? `${repoPath}/${filePath}` : filePath

    try {
      if (action === 'copy-name') {
        await navigator.clipboard.writeText(filePath.split('/').pop() ?? filePath)
      } else if (action === 'copy-relative') {
        await navigator.clipboard.writeText(filePath)
      } else if (action === 'copy-absolute') {
        await navigator.clipboard.writeText(absPath)
      } else if (action === 'reveal') {
        await git.revealFile(absPath)
      } else if (action === 'open-editor') {
        await git.openFileInEditor(absPath)
      } else if (action === 'open-submodule') {
        const submodule = submoduleForDiff(diff)
        if (canOpenSubmodule(submodule)) {
          await openSubmodule(submodule)
        }
      } else if (action === 'checkout-file') {
        const repoId = repoStore.activeRepoId
        const sha = commitOid.value
        if (repoId && sha) {
          await git.checkoutFileAtCommit(repoId, sha, filePath)
          await workspaceStore.refresh(repoId)
        }
      } else if (action === 'file-history') {
        showFileHistory({ filePath, mode: 'history' })
      } else if (action === 'file-blame') {
        showFileHistory({ filePath, mode: 'blame' })
      }
    } catch (error) {
      alert(String(error))
    }
  }

  return {
    fileMenu,
    fileMenuItems,
    openFileMenu,
    handleFileMenuAction,
  }
}
