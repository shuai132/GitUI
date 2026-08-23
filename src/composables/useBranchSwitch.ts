import { ref } from 'vue'
import { t } from '@/i18n'
import { useHistoryStore } from '@/stores/history'
import { useStashStore } from '@/stores/stash'
import { useWorkspaceStore } from '@/stores/workspace'

export type BranchSwitchMode = 'carry' | 'stash'

export function useBranchSwitch() {
  const historyStore = useHistoryStore()
  const stashStore = useStashStore()
  const workspaceStore = useWorkspaceStore()

  const dialogVisible = ref(false)
  const targetBranch = ref('')
  const sourceBranch = ref('HEAD')
  const changeCount = ref(0)
  const loading = ref(false)
  const activeMode = ref<BranchSwitchMode | null>(null)
  const changesStashed = ref(false)
  const error = ref<string | null>(null)

  function currentChangedPaths(): Set<string> {
    const status = workspaceStore.status
    return new Set([
      ...(status?.staged ?? []),
      ...(status?.unstaged ?? []),
      ...(status?.untracked ?? []),
    ].map((file) => file.path))
  }

  async function runSwitch(mode: BranchSwitchMode, prompted: boolean) {
    if (!targetBranch.value || loading.value) return
    loading.value = true
    activeMode.value = mode
    error.value = null
    try {
      if (mode === 'stash' && !changesStashed.value) {
        await stashStore.push(t('sidebar.branch.switchDialog.stashMessage', {
          source: sourceBranch.value,
          target: targetBranch.value,
        }))
        changesStashed.value = true
      }
      await historyStore.switchBranch(targetBranch.value)
      await workspaceStore.refresh()
      dialogVisible.value = false
      targetBranch.value = ''
      changesStashed.value = false
    } catch (cause) {
      if (!prompted) throw cause
      error.value = changesStashed.value
        ? t('sidebar.branch.switchDialog.failedAfterStash', { detail: String(cause) })
        : t('sidebar.branch.switchDialog.carryFailed', { detail: String(cause) })
    } finally {
      activeMode.value = null
      loading.value = false
    }
  }

  async function requestSwitch(name: string) {
    if (!name || loading.value) return
    targetBranch.value = name
    sourceBranch.value = workspaceStore.status?.head_branch ?? 'HEAD'
    changeCount.value = currentChangedPaths().size
    changesStashed.value = false
    error.value = null

    if (changeCount.value === 0) {
      await runSwitch('carry', false)
      return
    }
    dialogVisible.value = true
  }

  async function confirmSwitch(mode: BranchSwitchMode) {
    await runSwitch(mode, true)
  }

  function cancelSwitch() {
    if (loading.value) return
    dialogVisible.value = false
    targetBranch.value = ''
    changesStashed.value = false
    error.value = null
  }

  return {
    dialogVisible,
    targetBranch,
    sourceBranch,
    changeCount,
    loading,
    activeMode,
    changesStashed,
    error,
    requestSwitch,
    confirmSwitch,
    cancelSwitch,
  }
}
