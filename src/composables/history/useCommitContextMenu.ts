import { reactive, ref, computed, onMounted, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHistoryStore } from '@/stores/history'
import { useRepoStore } from '@/stores/repos'
import { useStashStore } from '@/stores/stash'
import { useMergeRebaseStore } from '@/stores/mergeRebase'
import { usePluginsStore } from '@/stores/plugins'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore } from '@/stores/ui'
import { useGlobalToast } from '@/composables/useGlobalToast'
import {
  isHistoryActionContextCurrent,
  type HistoryActionConfirmation,
  type HistoryCommitAction,
  type HistoryResetMode,
} from '@/composables/history/historyActionConfirmation'
import { mergeSourceNamesAtCommit } from '@/utils/mergeSources'
import { remoteBranchTagsAtCommit } from '@/composables/history/useCommitTags'
import type { ContextMenuItem } from '@/components/common/ContextMenu.vue'
import type { BranchInfo, CommitInfo } from '@/types/git'

const CHECKOUT_REMOTE_ACTION_PREFIX = 'checkout-remote:'
const COPY_BRANCH_NAME_ACTION_PREFIX = 'copy-branch-name:'
const CONFIRM_DIALOG_KEY: Record<HistoryCommitAction, string> = {
  checkout: 'confirmCheckout',
  'cherry-pick': 'confirmCherryPick',
  revert: 'confirmRevert',
}

type MenuLabel = (key: string, params?: Record<string, string>) => string

export function checkoutRemoteAction(branchName: string): string {
  return `${CHECKOUT_REMOTE_ACTION_PREFIX}${branchName}`
}

export function parseCheckoutRemoteAction(action: string): string | null {
  if (!action.startsWith(CHECKOUT_REMOTE_ACTION_PREFIX)) return null
  return action.slice(CHECKOUT_REMOTE_ACTION_PREFIX.length) || null
}

export function copyBranchNameAction(branchName: string): string {
  return `${COPY_BRANCH_NAME_ACTION_PREFIX}${branchName}`
}

export function parseCopyBranchNameAction(action: string): string | null {
  if (!action.startsWith(COPY_BRANCH_NAME_ACTION_PREFIX)) return null
  return action.slice(COPY_BRANCH_NAME_ACTION_PREFIX.length) || null
}

export function remoteBranchContextMenuItems(
  branches: BranchInfo[],
  label: MenuLabel,
): ContextMenuItem[] {
  return branches.flatMap((branch) => [
    {
      label: label('history.contextMenu.checkoutRemoteBranch', { branch: branch.name }),
      action: checkoutRemoteAction(branch.name),
    },
    {
      label: label('history.contextMenu.copyBranchName'),
      action: copyBranchNameAction(branch.name),
    },
  ])
}

export function useCommitContextMenu(
  currentBranchName: Ref<string>,
  headCommitOid: Ref<string>,
  isAncestorOfHead: (oid: string) => boolean,
  openMergeDialog: (candidates: string[]) => void,
  openRebaseDialog: (upstream: string, onto: string | null) => void,
) {
  const { t } = useI18n()
  const repoStore = useRepoStore()
  const historyStore = useHistoryStore()
  const stashStore = useStashStore()
  const mergeRebaseStore = useMergeRebaseStore()
  const pluginsStore = usePluginsStore()
  const workspaceStore = useWorkspaceStore()
  const uiStore = useUiStore()
  const { showToast, showError, showActionError } = useGlobalToast()

  onMounted(() => {
    if (!pluginsStore.loaded) {
      pluginsStore.load().catch(() => {})
    }
  })

  // ── Context Menu State ───────────────────────────────────────────────
  const commitMenu = reactive({
    visible: false,
    x: 0,
    y: 0,
    commit: null as CommitInfo | null,
  })

  // ── Dialog States ────────────────────────────────────────────────────
  const showCreateBranchDialog = ref(false)
  const showCreateTagDialog = ref(false)
  const createTagAnnotated = ref(false)
  const showCheckoutRemoteDialog = ref(false)
  const checkoutInitialRemote = ref<string | null>(null)
  const dialogCommit = ref<CommitInfo | null>(null)
  const pendingActionConfirmation = ref<HistoryActionConfirmation | null>(null)
  const actionConfirmationLoading = ref(false)

  // Edit Message Dialog
  const showEditMessageDialog = ref(false)
  const editMessageCommit = ref<CommitInfo | null>(null)
  const editMessageText = ref('')
  const editMessageAuthorTime = ref('')
  const editMessageCommitterTime = ref('')
  const editMessageAuthorName = ref('')
  const editMessageAuthorEmail = ref('')
  const editMessageAutoStash = ref(false)
  const editMessageSubmitting = ref(false)
  const editMessageRepoId = ref<string | null>(null)
  const editMessageHeadOid = ref<string | null>(null)
  const editMessageHeadRef = ref('HEAD')

  // Drop Unreachable Dialog
  const dropUnreachableDialog = reactive({
    visible: false,
    commit: null as CommitInfo | null,
    count: 0,
    previewing: false,
    previewError: null as string | null,
    submitting: false,
  })
  let dropUnreachablePreviewSeq = 0

  // ── Helpers ──────────────────────────────────────────────────────────
  function stashEntryForCommit(oid: string) {
    return stashStore.entries.find((s) => s.commit_oid === oid) ?? null
  }

  function confirmationContext(repoId: string) {
    return {
      repoId,
      expectedHeadOid: headCommitOid.value,
      expectedHeadRef: currentBranchName.value === 'HEAD'
        ? 'HEAD'
        : `refs/heads/${currentBranchName.value}`,
    }
  }

  function openCommitActionConfirmation(action: HistoryCommitAction, c: CommitInfo) {
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    const dialogKey = CONFIRM_DIALOG_KEY[action]
    pendingActionConfirmation.value = {
      ...confirmationContext(repoId),
      kind: action,
      commitOid: c.oid,
      title: t(`history.dialog.${dialogKey}.title`),
      message: t(`history.dialog.${dialogKey}.body`, {
        shortOid: c.short_oid,
        summary: c.summary,
      }),
      confirmLabel: t(`history.dialog.${dialogKey}.confirm`),
      loadingLabel: t(`history.dialog.${dialogKey}.running`),
      danger: false,
    }
  }

  function openResetConfirmation(c: CommitInfo, mode: HistoryResetMode) {
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    const modeLabel = t(`history.dialog.confirmReset.mode.${mode}`)
    pendingActionConfirmation.value = {
      ...confirmationContext(repoId),
      kind: 'reset',
      commitOid: c.oid,
      mode,
      title: t('history.dialog.confirmReset.title', { branch: currentBranchName.value }),
      message: t(
        mode === 'hard'
          ? 'history.dialog.confirmReset.hardBody'
          : 'history.dialog.confirmReset.body',
        {
          branch: currentBranchName.value,
          mode: modeLabel,
          shortOid: c.short_oid,
          summary: c.summary,
        },
      ),
      confirmLabel: t('history.dialog.confirmReset.confirm', { mode: modeLabel }),
      loadingLabel: t('history.dialog.confirmReset.running'),
      danger: mode === 'hard',
    }
  }

  function openStashDropConfirmation(c: CommitInfo, index: number, message: string) {
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    pendingActionConfirmation.value = {
      kind: 'stash-drop',
      repoId,
      index,
      commitOid: c.oid,
      title: t('history.dialog.confirmStashDelete.title'),
      message: t('history.dialog.confirmStashDelete.body', { index, message }),
      confirmLabel: t('history.dialog.confirmStashDelete.confirm'),
      loadingLabel: t('history.dialog.confirmStashDelete.running'),
      danger: true,
    }
  }

  function toDatetimeLocal(unixSecs: number): string {
    const d = new Date(unixSecs * 1000)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }

  function fromDatetimeLocal(s: string): number {
    return Math.floor(new Date(s).getTime() / 1000)
  }

  function pluginAction(pluginId: string, commandId: string): string {
    return `plugin:${pluginId}:${commandId}`
  }

  function parsePluginAction(action: string): { pluginId: string; commandId: string } | null {
    if (!action.startsWith('plugin:')) return null
    const payload = action.slice('plugin:'.length)
    const separator = payload.indexOf(':')
    if (separator < 0) return null
    const pluginId = payload.slice(0, separator)
    const commandId = payload.slice(separator + 1)
    if (!pluginId || !commandId) return null
    return { pluginId, commandId }
  }

  function commitSelection(c: CommitInfo) {
    return {
      type: 'commit',
      oid: c.oid,
      short_oid: c.short_oid,
      message: c.message,
      summary: c.summary,
      author_name: c.author_name,
      author_email: c.author_email,
      author_time: c.author_time,
      time: c.time,
      parent_oids: c.parent_oids,
      is_unreachable: c.is_unreachable,
      is_stash: c.is_stash,
      is_reflog_tip: c.is_reflog_tip,
    }
  }

  function appendPluginMenu(items: ContextMenuItem[]): ContextMenuItem[] {
    if (pluginsStore.commitContextCommands.length === 0) return items
    return [
      ...items,
      { separator: true },
      {
        label: t('settings.plugins.actionGroup'),
        children: pluginsStore.commitContextCommands.map((command) => ({
          label: command.label,
          action: pluginAction(command.plugin_id, command.command_id),
          disabled: pluginsStore.executing !== null,
          title: command.description,
        })),
      },
    ]
  }

  async function refreshAfterPlugin(refresh: string[]) {
    if (refresh.includes('workspace')) await workspaceStore.refresh()
    if (refresh.includes('history')) await historyStore.loadLog()
    if (refresh.includes('branches')) await historyStore.loadBranches()
  }

  function openDropUnreachableDialog(c: CommitInfo) {
    const requestSeq = ++dropUnreachablePreviewSeq
    dropUnreachableDialog.commit = c
    dropUnreachableDialog.count = 0
    dropUnreachableDialog.previewing = true
    dropUnreachableDialog.previewError = null
    dropUnreachableDialog.submitting = false
    dropUnreachableDialog.visible = true

    void historyStore.previewDropUnreachableCommit(c.oid)
      .then((count) => {
        if (
          requestSeq !== dropUnreachablePreviewSeq ||
          dropUnreachableDialog.commit?.oid !== c.oid
        ) {
          return
        }
        dropUnreachableDialog.count = count
      })
      .catch((err: unknown) => {
        if (
          requestSeq !== dropUnreachablePreviewSeq ||
          dropUnreachableDialog.commit?.oid !== c.oid
        ) {
          return
        }
        dropUnreachableDialog.previewError = String(err)
      })
      .finally(() => {
        if (
          requestSeq !== dropUnreachablePreviewSeq ||
          dropUnreachableDialog.commit?.oid !== c.oid
        ) {
          return
        }
        dropUnreachableDialog.previewing = false
      })
  }

  const isEditingHeadCommit = computed(
    () => !!editMessageCommit.value && editMessageCommit.value.oid === headCommitOid.value,
  )

  // ── Menu Items Calculation ───────────────────────────────────────────
  const commitMenuItems = computed<ContextMenuItem[]>(() => {
    const c = commitMenu.commit
    if (!c) return []

    if (c.is_stash) {
      const entry = stashEntryForCommit(c.oid)
      const hasEntry = entry !== null
      return appendPluginMenu([
        { label: t('history.contextMenu.stashApply'), action: 'stash-apply', disabled: !hasEntry },
        { label: t('history.contextMenu.stashPop'), action: 'stash-pop', disabled: !hasEntry },
        { label: t('history.contextMenu.stashDelete'), action: 'stash-delete', disabled: !hasEntry },
      ])
    }

    const ongoing = mergeRebaseStore.isOngoing
    const pointedBranches = mergeSourceNamesAtCommit(historyStore.branches, c.oid)
    const canMerge = !ongoing && pointedBranches.length > 0 && c.oid !== headCommitOid.value
    const canRebase = !ongoing && c.oid !== headCommitOid.value
    const isHead = c.oid === headCommitOid.value
    const canEditMessage =
      !c.is_unreachable &&
      !ongoing &&
      (isHead || (c.parent_oids.length === 1 && isAncestorOfHead(c.oid)))
    const checkoutRemoteItems = remoteBranchContextMenuItems(
      remoteBranchTagsAtCommit(historyStore.branches, c.oid, uiStore.showRemoteBranches),
      t,
    )

    const items: ContextMenuItem[] = [
      { label: t('history.contextMenu.checkout'), action: 'checkout' },
      ...checkoutRemoteItems,
      { separator: true },
      {
        label: t('history.contextMenu.editMessage'),
        action: 'edit-message',
        disabled: !canEditMessage,
      },
      { separator: true },
      { label: t('history.contextMenu.createBranch'), action: 'create-branch' },
      { label: t('history.contextMenu.cherryPick'), action: 'cherry-pick' },
      {
        label: t('history.contextMenu.resetTo', { branch: currentBranchName.value }),
        children: [
          { label: t('history.contextMenu.resetSoft'), action: 'reset-soft' },
          { label: t('history.contextMenu.resetMixed'), action: 'reset-mixed' },
          { label: t('history.contextMenu.resetHard'), action: 'reset-hard' },
        ],
      },
      { label: t('history.contextMenu.revert'), action: 'revert' },
      { separator: true },
      {
        label: t('history.contextMenu.mergeInto', { branch: currentBranchName.value }),
        action: 'merge-into',
        disabled: !canMerge,
      },
      {
        label: t('history.contextMenu.rebaseOnto', { branch: currentBranchName.value }),
        action: 'rebase-onto',
        disabled: !canRebase,
      },
      { separator: true },
      { label: t('history.contextMenu.copySha'), action: 'copy-sha' },
      { separator: true },
      { label: t('history.contextMenu.createTag'), action: 'create-tag' },
      { label: t('history.contextMenu.createAnnotatedTag'), action: 'create-annotated-tag' },
    ]

    if (c.is_unreachable) {
      items.push(
        { separator: true },
        { label: t('history.contextMenu.dropUnreachable'), action: 'drop-unreachable' },
      )
    }

    return appendPluginMenu(items)
  })

  // ── Actions ──────────────────────────────────────────────────────────
  function onCommitContextMenu(e: MouseEvent, commit: CommitInfo | undefined, hideTooltipCb?: () => void) {
    if (!commit) return
    e.preventDefault()
    if (hideTooltipCb) hideTooltipCb()
    commitMenu.commit = commit
    commitMenu.x = e.clientX
    commitMenu.y = e.clientY
    commitMenu.visible = true
  }

  function closeCommitMenu() {
    commitMenu.visible = false
  }

  async function onCommitMenuAction(action: string) {
    const c = commitMenu.commit
    if (!c) return
    try {
      const pluginActionParts = parsePluginAction(action)
      if (pluginActionParts) {
        const result = await pluginsStore.execute(
          pluginActionParts.pluginId,
          pluginActionParts.commandId,
          { selection: commitSelection(c) },
        )
        if (result.message) showToast('success', result.message)
        await refreshAfterPlugin(result.refresh)
        return
      }
      const checkoutRemoteBranch = parseCheckoutRemoteAction(action)
      if (checkoutRemoteBranch) {
        checkoutInitialRemote.value = checkoutRemoteBranch
        showCheckoutRemoteDialog.value = true
        return
      }
      const copiedBranchName = parseCopyBranchNameAction(action)
      if (copiedBranchName) {
        await navigator.clipboard.writeText(copiedBranchName)
        return
      }

      switch (action) {
        case 'stash-apply': {
          const entry = stashEntryForCommit(c.oid)
          if (entry) await stashStore.apply(entry.index)
          break
        }
        case 'stash-pop': {
          const entry = stashEntryForCommit(c.oid)
          if (entry) await stashStore.pop(entry.index)
          break
        }
        case 'stash-delete': {
          const entry = stashEntryForCommit(c.oid)
          if (!entry) break
          openStashDropConfirmation(c, entry.index, entry.message)
          break
        }
        case 'checkout':
          openCommitActionConfirmation('checkout', c)
          break
        case 'edit-message':
          editMessageCommit.value = c
          editMessageText.value = c.message.trim()
          editMessageAuthorTime.value = toDatetimeLocal(c.author_time)
          editMessageCommitterTime.value = toDatetimeLocal(Math.floor(Date.now() / 1000))
          editMessageAuthorName.value = c.author_name
          editMessageAuthorEmail.value = c.author_email
          editMessageAutoStash.value = false
          editMessageSubmitting.value = false
          editMessageRepoId.value = repoStore.activeRepoId
          editMessageHeadOid.value = headCommitOid.value
          editMessageHeadRef.value = currentBranchName.value === 'HEAD'
            ? 'HEAD'
            : `refs/heads/${currentBranchName.value}`
          showEditMessageDialog.value = true
          break
        case 'create-branch':
          dialogCommit.value = c
          showCreateBranchDialog.value = true
          break
        case 'cherry-pick':
          openCommitActionConfirmation('cherry-pick', c)
          break
        case 'revert':
          openCommitActionConfirmation('revert', c)
          break
        case 'reset-soft':
        case 'reset-mixed':
        case 'reset-hard': {
          const mode = action.slice(6) as HistoryResetMode
          openResetConfirmation(c, mode)
          break
        }
        case 'merge-into': {
          openMergeDialog(mergeSourceNamesAtCommit(historyStore.branches, c.oid))
          break
        }
        case 'rebase-onto':
          openRebaseDialog(c.oid, null)
          break
        case 'copy-sha':
          await navigator.clipboard.writeText(c.oid)
          break
        case 'drop-unreachable': {
          openDropUnreachableDialog(c)
          break
        }
        case 'create-tag':
          dialogCommit.value = c
          createTagAnnotated.value = false
          showCreateTagDialog.value = true
          break
        case 'create-annotated-tag':
          dialogCommit.value = c
          createTagAnnotated.value = true
          showCreateTagDialog.value = true
          break
      }
    } catch (err) {
      showActionError(err)
    }
  }

  async function onActionConfirmationConfirm() {
    const pending = pendingActionConfirmation.value
    if (!pending || actionConfirmationLoading.value) return
    if (!isHistoryActionContextCurrent(
      pending,
      repoStore.activeRepoId,
      headCommitOid.value,
      currentBranchName.value === 'HEAD' ? 'HEAD' : `refs/heads/${currentBranchName.value}`,
    )) {
      onActionConfirmationCancel()
      showError(t('errors.history.contextChanged'))
      return
    }
    if (pending.kind === 'stash-drop') {
      const current = stashEntryForCommit(pending.commitOid)
      if (!current || current.index !== pending.index) {
        onActionConfirmationCancel()
        showError(t('errors.stash.targetChanged'))
        return
      }
    }

    actionConfirmationLoading.value = true
    try {
      switch (pending.kind) {
        case 'checkout':
          await historyStore.checkoutCommit(
            pending.commitOid,
            pending.expectedHeadOid,
            pending.expectedHeadRef,
          )
          break
        case 'cherry-pick':
          await historyStore.cherryPickCommit(
            pending.commitOid,
            pending.expectedHeadOid,
            pending.expectedHeadRef,
          )
          break
        case 'revert':
          await historyStore.revertCommit(
            pending.commitOid,
            pending.expectedHeadOid,
            pending.expectedHeadRef,
          )
          break
        case 'reset':
          await historyStore.resetToCommit(
            pending.commitOid,
            pending.mode,
            pending.expectedHeadOid,
            pending.expectedHeadRef,
          )
          break
        case 'stash-drop':
          await stashStore.drop(pending.index, pending.commitOid)
          break
      }
    } catch {
      // IPC 错误由 errors store 统一映射并通过 ToolbarToast 展示。
    } finally {
      actionConfirmationLoading.value = false
      pendingActionConfirmation.value = null
    }
  }

  function onActionConfirmationCancel() {
    if (actionConfirmationLoading.value) return
    pendingActionConfirmation.value = null
  }

  async function onEditMessageConfirm() {
    const text = editMessageText.value.trim()
    const commit = editMessageCommit.value
    if (!text || !commit || editMessageSubmitting.value) return
    const repoId = editMessageRepoId.value
    const expectedHead = editMessageHeadOid.value
    if (
      !repoId ||
      !expectedHead ||
      repoStore.activeRepoId !== repoId ||
      headCommitOid.value !== expectedHead ||
      (currentBranchName.value === 'HEAD'
        ? 'HEAD'
        : `refs/heads/${currentBranchName.value}`) !== editMessageHeadRef.value
    ) {
      showError(t('errors.history.contextChanged'))
      return
    }
    editMessageSubmitting.value = true
    const authorTime = editMessageAuthorTime.value ? fromDatetimeLocal(editMessageAuthorTime.value) : undefined
    const committerTime = editMessageCommitterTime.value ? fromDatetimeLocal(editMessageCommitterTime.value) : undefined
    const authorName = editMessageAuthorName.value.trim() || undefined
    const authorEmail = editMessageAuthorEmail.value.trim() || undefined
    try {
      if (commit.oid === headCommitOid.value) {
        await historyStore.amendCommitMessage(
          repoId,
          text,
          authorTime,
          committerTime,
          authorName,
          authorEmail,
          expectedHead,
          editMessageHeadRef.value,
        )
      } else {
        const parentOid = commit.parent_oids[0]
        if (!parentOid) return
        const todo = await mergeRebaseStore.planRebase(
          repoId,
          parentOid,
          null,
          expectedHead,
          editMessageHeadRef.value,
          parentOid,
          null,
        )
        const idx = todo.findIndex((x) => x.oid === commit.oid)
        if (idx < 0) {
          showError(t('errors.rebase.planMismatch', { shortOid: commit.short_oid }))
          return
        }
        todo[idx] = {
          ...todo[idx],
          action: 'reword',
          new_message: text,
          new_author_time: authorTime,
          new_committer_time: committerTime,
          new_author_name: authorName,
          new_author_email: authorEmail,
        }
        await mergeRebaseStore.startRebase(
          repoId,
          parentOid,
          null,
          todo,
          editMessageAutoStash.value,
          expectedHead,
          editMessageHeadRef.value,
          parentOid,
          null,
        )
      }
      showEditMessageDialog.value = false
    } catch (err) {
      showActionError(err)
    } finally {
      editMessageSubmitting.value = false
    }
  }

  async function onDropUnreachableConfirm() {
    const c = dropUnreachableDialog.commit
    if (
      !c ||
      dropUnreachableDialog.previewing ||
      dropUnreachableDialog.previewError ||
      dropUnreachableDialog.count <= 0 ||
      dropUnreachableDialog.submitting
    ) {
      return
    }
    dropUnreachableDialog.submitting = true
    try {
      await historyStore.dropUnreachableCommit(c.oid)
      dropUnreachableDialog.visible = false
      dropUnreachableDialog.commit = null
    } catch (err) {
      showActionError(err)
    } finally {
      dropUnreachableDialog.submitting = false
    }
  }

  function onDropUnreachableCancel() {
    dropUnreachablePreviewSeq += 1
    dropUnreachableDialog.visible = false
    dropUnreachableDialog.commit = null
    dropUnreachableDialog.previewing = false
    dropUnreachableDialog.previewError = null
  }

  return {
    commitMenu,
    commitMenuItems,
    onCommitContextMenu,
    closeCommitMenu,
    onCommitMenuAction,

    showCreateBranchDialog,
    showCreateTagDialog,
    createTagAnnotated,
    showCheckoutRemoteDialog,
    checkoutInitialRemote,
    dialogCommit,
    pendingActionConfirmation,
    actionConfirmationLoading,
    onActionConfirmationConfirm,
    onActionConfirmationCancel,

    showEditMessageDialog,
    editMessageText,
    editMessageAuthorTime,
    editMessageCommitterTime,
    editMessageAuthorName,
    editMessageAuthorEmail,
    editMessageAutoStash,
    editMessageSubmitting,
    isEditingHeadCommit,
    onEditMessageConfirm,

    dropUnreachableDialog,
    onDropUnreachableConfirm,
    onDropUnreachableCancel,
  }
}
