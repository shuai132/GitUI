import { reactive, ref, computed, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHistoryStore } from '@/stores/history'
import { useStashStore } from '@/stores/stash'
import { useMergeRebaseStore } from '@/stores/mergeRebase'
import type { ContextMenuItem } from '@/components/common/ContextMenu.vue'
import type { CommitInfo } from '@/types/git'

export function useCommitContextMenu(
  currentBranchName: Ref<string>,
  headCommitOid: Ref<string>,
  isAncestorOfHead: (oid: string) => boolean,
  openMergeDialog: (candidates: string[]) => void,
  openRebaseDialog: (upstream: string, onto: string | null) => void,
) {
  const { t } = useI18n()
  const historyStore = useHistoryStore()
  const stashStore = useStashStore()
  const mergeRebaseStore = useMergeRebaseStore()

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
  const dialogCommit = ref<CommitInfo | null>(null)

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

  // Drop Unreachable Dialog
  const dropUnreachableDialog = reactive({
    visible: false,
    commit: null as CommitInfo | null,
    count: 0,
    submitting: false,
  })

  // ── Helpers ──────────────────────────────────────────────────────────
  function stashEntryForCommit(oid: string) {
    return stashStore.entries.find((s) => s.commit_oid === oid) ?? null
  }

  function toDatetimeLocal(unixSecs: number): string {
    const d = new Date(unixSecs * 1000)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }

  function fromDatetimeLocal(s: string): number {
    return Math.floor(new Date(s).getTime() / 1000)
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
      return [
        { label: t('history.contextMenu.stashApply'), action: 'stash-apply', disabled: !hasEntry },
        { label: t('history.contextMenu.stashPop'), action: 'stash-pop', disabled: !hasEntry },
        { label: t('history.contextMenu.stashDelete'), action: 'stash-delete', disabled: !hasEntry },
      ]
    }

    const ongoing = mergeRebaseStore.isOngoing
    const pointedBranches = historyStore.branches
      .filter(b => !b.is_remote && b.commit_oid === c.oid)
      .map(b => b.name)
    const canMerge = !ongoing && pointedBranches.length > 0 && c.oid !== headCommitOid.value
    const canRebase = !ongoing && c.oid !== headCommitOid.value
    const isHead = c.oid === headCommitOid.value
    const canEditMessage =
      !c.is_unreachable &&
      !ongoing &&
      (isHead || (c.parent_oids.length === 1 && isAncestorOfHead(c.oid)))

    const items: ContextMenuItem[] = [
      { label: t('history.contextMenu.checkout'), action: 'checkout' },
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

    return items
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
          if (confirm(t('history.dialog.confirmStashDelete.body', { index: entry.index, message: entry.message }))) {
            await stashStore.drop(entry.index)
          }
          break
        }
        case 'checkout':
          if (confirm(t('history.dialog.confirmCheckout.body', { shortOid: c.short_oid }))) {
            await historyStore.checkoutCommit(c.oid)
          }
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
          showEditMessageDialog.value = true
          break
        case 'create-branch':
          dialogCommit.value = c
          showCreateBranchDialog.value = true
          break
        case 'cherry-pick':
          if (confirm(t('history.dialog.confirmCherryPick.body', { summary: c.summary }))) {
            await historyStore.cherryPickCommit(c.oid)
          }
          break
        case 'revert':
          if (confirm(t('history.dialog.confirmRevert.body', { summary: c.summary }))) {
            await historyStore.revertCommit(c.oid)
          }
          break
        case 'reset-soft':
        case 'reset-mixed':
        case 'reset-hard': {
          const mode = action.slice(6) as 'soft' | 'mixed' | 'hard'
          const modeLabel = t(`history.dialog.confirmReset.mode.${mode}`)
          const warn =
            mode === 'hard'
              ? t('history.dialog.confirmReset.hardBody', {
                  branch: currentBranchName.value,
                  shortOid: c.short_oid,
                })
              : t('history.dialog.confirmReset.body', {
                  branch: currentBranchName.value,
                  mode: modeLabel,
                  shortOid: c.short_oid,
                })
          if (confirm(warn)) await historyStore.resetToCommit(c.oid, mode)
          break
        }
        case 'merge-into': {
          const candidates = historyStore.branches
            .filter(b => !b.is_remote && b.commit_oid === c.oid && !b.is_head)
            .map(b => b.name)
          openMergeDialog(candidates)
          break
        }
        case 'rebase-onto':
          openRebaseDialog(c.oid, null)
          break
        case 'copy-sha':
          await navigator.clipboard.writeText(c.oid)
          break
        case 'drop-unreachable': {
          const count = await historyStore.previewDropUnreachableCommit(c.oid)
          dropUnreachableDialog.commit = c
          dropUnreachableDialog.count = count
          dropUnreachableDialog.submitting = false
          dropUnreachableDialog.visible = true
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
      alert(String(err))
    }
  }

  async function onEditMessageConfirm() {
    const text = editMessageText.value.trim()
    const commit = editMessageCommit.value
    if (!text || !commit || editMessageSubmitting.value) return
    editMessageSubmitting.value = true
    const authorTime = editMessageAuthorTime.value ? fromDatetimeLocal(editMessageAuthorTime.value) : undefined
    const committerTime = editMessageCommitterTime.value ? fromDatetimeLocal(editMessageCommitterTime.value) : undefined
    const authorName = editMessageAuthorName.value.trim() || undefined
    const authorEmail = editMessageAuthorEmail.value.trim() || undefined
    try {
      if (commit.oid === headCommitOid.value) {
        await historyStore.amendCommitMessage(text, authorTime, committerTime, authorName, authorEmail)
      } else {
        const parentOid = commit.parent_oids[0]
        if (!parentOid) return
        const todo = await mergeRebaseStore.planRebase(parentOid, null)
        const idx = todo.findIndex((x) => x.oid === commit.oid)
        if (idx < 0) {
          alert(t('errors.rebase.planMismatch', { shortOid: commit.short_oid }))
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
        await mergeRebaseStore.startRebase(parentOid, null, todo, editMessageAutoStash.value)
      }
      showEditMessageDialog.value = false
    } catch (err) {
      alert(String(err))
    } finally {
      editMessageSubmitting.value = false
    }
  }

  async function onDropUnreachableConfirm() {
    const c = dropUnreachableDialog.commit
    if (!c) return
    dropUnreachableDialog.submitting = true
    try {
      await historyStore.dropUnreachableCommit(c.oid)
      dropUnreachableDialog.visible = false
    } catch (err) {
      alert(String(err))
    } finally {
      dropUnreachableDialog.submitting = false
    }
  }

  function onDropUnreachableCancel() {
    dropUnreachableDialog.visible = false
    dropUnreachableDialog.commit = null
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
    dialogCommit,

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
