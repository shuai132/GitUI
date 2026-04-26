<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useHistoryStore } from '@/stores/history'
import { useRepoStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { useSidebarSectionState } from '@/composables/useSidebarSectionState'
import { useGitCommands } from '@/composables/useGitCommands'
import { buildBranchTree } from '@/utils/branchTree'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import AddRemoteDialog from '@/components/remote/AddRemoteDialog.vue'
import EditRemoteDialog from '@/components/remote/EditRemoteDialog.vue'
import CheckoutRemoteDialog from '@/components/branch/CheckoutRemoteDialog.vue'
import BranchTreeNode from './BranchTreeNode.vue' // Wait, BranchTreeNode is in the parent dir in the old code. We need to import from '../layout/BranchTreeNode.vue' or move it.
import type { BranchInfo } from '@/types/git'

const { t } = useI18n()
const router = useRouter()
const historyStore = useHistoryStore()
const repoStore = useRepoStore()
const uiStore = useUiStore()
const sectionState = useSidebarSectionState()
const git = useGitCommands()

const localBranches = computed(() => historyStore.branches.filter((b) => !b.is_remote))
const currentUpstream = computed(() => localBranches.value.find((b) => b.is_head)?.upstream)

const remoteBranchesFlat = computed(() => historyStore.branches.filter((b) => b.is_remote))

const remoteTree = computed(() =>
  buildBranchTree(remoteBranchesFlat.value, historyStore.remotes.map((r) => r.name))
)

// Add / Edit Remote
const addRemoteDlg = reactive({ visible: false })
const editRemoteDlg = reactive({
  visible: false,
  target: null as { name: string; url: string | null } | null,
})

function openAddRemoteDialog(e: MouseEvent) {
  e.stopPropagation()
  addRemoteDlg.visible = true
}

async function onAddRemoteSuccess() {
  await historyStore.loadBranches()
}

function onDeleteRemote(remoteName: string) {
  const repoId = repoStore.activeRepoId
  if (!repoId) return
  openConfirm(
    t('remote.confirmDelete.title'),
    t('remote.confirmDelete.message', { name: remoteName }),
    async () => {
      await git.removeRemote(repoId, remoteName)
      await historyStore.loadBranches()
    },
    { loadingLabel: t('common.deleting', '删除中...') }
  )
}

// Remote Item Menu (for the remote node itself like "origin")
const remoteMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  targetName: null as string | null,
  isSection: false,
})

const remoteMenuItems = computed<ContextMenuItem[]>(() => {
  if (remoteMenu.isSection) {
    return [{ label: t('toolbar.opLabels.fetch', 'Fetch') + ' All', action: 'fetch-all' }]
  }
  return [
    { label: t('toolbar.opLabels.fetch', 'Fetch'), action: 'fetch' },
    { label: t('common.edit', 'Edit'), action: 'edit' },
    { separator: true },
    { label: t('sidebar.branch.menu.delete', 'Delete...'), action: 'delete', danger: true },
  ]
})

function openRemoteSectionMenu(e: MouseEvent) {
  e.preventDefault()
  remoteMenu.targetName = null
  remoteMenu.isSection = true
  remoteMenu.x = e.clientX
  remoteMenu.y = e.clientY
  remoteMenu.visible = true
}

function openRemoteItemMenu(e: MouseEvent, name: string) {
  e.preventDefault()
  remoteMenu.targetName = name
  remoteMenu.isSection = false
  remoteMenu.x = e.clientX
  remoteMenu.y = e.clientY
  remoteMenu.visible = true
}

function closeRemoteMenu() {
  remoteMenu.visible = false
}

async function onRemoteMenuAction(action: string) {
  const target = remoteMenu.targetName
  const repoId = repoStore.activeRepoId
  if (!repoId) return

  try {
    if (action === 'fetch-all') {
      uiStore.requestFetch('--all')
    } else if (action === 'fetch' && target) {
      uiStore.requestFetch(target)
    } else if (action === 'edit' && target) {
      const remote = historyStore.remotes.find(r => r.name === target)
      if (remote) {
        editRemoteDlg.target = remote
        editRemoteDlg.visible = true
      }
    } else if (action === 'delete' && target) {
      onDeleteRemote(target)
    }
  } catch (e: unknown) {
    const { useErrorsStore } = await import('@/stores/errors')
    useErrorsStore().push(`remote menu ${action}`, e)
  }
}

// Remote Branch Operations (checkout, delete branch)
function jumpToBranchCommit(commitOid: string) {
  historyStore.pendingJumpOid = commitOid
  router.push('/history')
}

function onSelectRemoteBranch(branch: BranchInfo) {
  if (branch.commit_oid) jumpToBranchCommit(branch.commit_oid)
}

const showCheckoutDialog = ref(false)
const checkoutInitialRemote = ref<string | null>(null)

function onDblclickRemoteBranch(branch: BranchInfo) {
  checkoutInitialRemote.value = branch.name
  showCheckoutDialog.value = true
}

// Branch Context Menu
const branchMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  branch: null as BranchInfo | null,
})

const branchMenuItems = computed<ContextMenuItem[]>(() => {
  const b = branchMenu.branch
  if (!b) return []
  const items: ContextMenuItem[] = []

  items.push({ label: t('sidebar.branch.menu.checkoutRemote'), action: 'checkout-remote' })
  items.push({ label: t('sidebar.branch.menu.copyName'), action: 'copy-name' })
  items.push({ separator: true })
  items.push({ label: t('sidebar.branch.menu.delete'), action: 'delete', danger: true })

  return items
})

function openBranchContextMenu(e: MouseEvent, branch: BranchInfo) {
  e.preventDefault()
  branchMenu.branch = branch
  branchMenu.x = e.clientX
  branchMenu.y = e.clientY
  branchMenu.visible = true
}

function closeBranchContextMenu() {
  branchMenu.visible = false
}

async function onBranchMenuAction(action: string) {
  const b = branchMenu.branch
  if (!b) return
  try {
    switch (action) {
      case 'checkout-remote':
        checkoutInitialRemote.value = b.name
        showCheckoutDialog.value = true
        break
      case 'copy-name':
        await navigator.clipboard.writeText(b.name)
        break
      case 'delete':
        openConfirm(
          t('sidebar.branch.menu.delete'),
          t('sidebar.branch.confirmDeleteRemote', { name: b.name }),
          async () => {
            const slashIdx = b.name.indexOf('/')
            if (slashIdx > 0) {
              const remote = b.name.substring(0, slashIdx)
              const branch = b.name.substring(slashIdx + 1)
              await historyStore.deleteRemoteBranch(remote, branch)
            }
          },
          { loadingLabel: t('common.deleting', '删除中...') }
        )
        break
    }
  } catch (err) {
    console.error(err)
  }
}

// Confirm Dialog
const confirmDlg = reactive({
  visible: false,
  title: '',
  message: '',
  loading: false,
  loadingLabel: '',
  _resolve: null as (() => Promise<void>) | null,
})

function openConfirm(
  title: string,
  message: string,
  action: () => Promise<void>,
  options?: { loadingLabel?: string },
) {
  confirmDlg.title = title
  confirmDlg.message = message
  confirmDlg._resolve = action
  confirmDlg.loading = false
  confirmDlg.loadingLabel = options?.loadingLabel || ''
  confirmDlg.visible = true
}

async function onConfirmDialogConfirm() {
  if (!confirmDlg._resolve) return
  confirmDlg.loading = true
  try {
    await confirmDlg._resolve()
  } catch (err) {
    console.error(err)
    alert(t('common.operationFailed', { detail: String(err) }))
  } finally {
    confirmDlg.loading = false
    confirmDlg.visible = false
  }
}

function onConfirmDialogCancel() {
  confirmDlg.visible = false
}
</script>

<template>
  <div class="section" v-if="repoStore.activeRepoId">
    <div class="section-title collapsible" @click="sectionState.toggle('remote')" @contextmenu="openRemoteSectionMenu">
      <svg class="chevron" :class="{ open: !sectionState.isCollapsed('remote') }"
            width="10" height="10" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <span class="section-label">REMOTE</span>
      <span class="section-count">{{ remoteBranchesFlat.length }}</span>
      <button
        class="section-add-btn"
        :title="t('sidebar.remote.addButton')"
        @click.stop="openAddRemoteDialog"
      >+</button>
    </div>
    <template v-if="!sectionState.isCollapsed('remote')">
      <BranchTreeNode
        v-for="root in remoteTree"
        :key="root.path"
        :node="root"
        :level="0"
        :is-remote-root="true"
        :current-upstream="currentUpstream"
        @select-branch="onSelectRemoteBranch"
        @dblclick-branch="onDblclickRemoteBranch"
        @branch-context-menu="openBranchContextMenu"
        @delete-remote="onDeleteRemote"
        @remote-context-menu="openRemoteItemMenu"
      />
    </template>

    <ContextMenu
      :visible="remoteMenu.visible"
      :x="remoteMenu.x"
      :y="remoteMenu.y"
      :items="remoteMenuItems"
      @select="onRemoteMenuAction"
      @close="closeRemoteMenu"
    />

    <ContextMenu
      :visible="branchMenu.visible"
      :x="branchMenu.x"
      :y="branchMenu.y"
      :items="branchMenuItems"
      @select="onBranchMenuAction"
      @close="closeBranchContextMenu"
    />

    <AddRemoteDialog
      :visible="addRemoteDlg.visible"
      @close="addRemoteDlg.visible = false"
      @success="onAddRemoteSuccess"
    />

    <EditRemoteDialog
      :visible="editRemoteDlg.visible"
      :target="editRemoteDlg.target"
      @close="editRemoteDlg.visible = false"
      @success="onAddRemoteSuccess"
    />

    <CheckoutRemoteDialog
      :visible="showCheckoutDialog"
      :remote-branches="remoteBranchesFlat"
      :initial-remote="checkoutInitialRemote"
      @close="showCheckoutDialog = false"
    />

    <ConfirmDialog
      :visible="confirmDlg.visible"
      :title="confirmDlg.title"
      :message="confirmDlg.message"
      :loading="confirmDlg.loading"
      :danger="true"
      :confirm-label="t('common.delete')"
      :loading-label="confirmDlg.loadingLabel || undefined"
      @confirm="onConfirmDialogConfirm"
      @cancel="onConfirmDialogCancel"
    />
  </div>
</template>

<style scoped>
@import './sidebar-common.css';
</style>
