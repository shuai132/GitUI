<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useHistoryStore } from '@/stores/history'
import { useWorkspaceStore } from '@/stores/workspace'
import { useRepoStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { useSidebarSectionState } from '@/composables/useSidebarSectionState'
import { buildLocalBranchTree } from '@/utils/branchTree'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import BranchTreeNode from './BranchTreeNode.vue'
import SidebarSearchControl from './SidebarSearchControl.vue'
import { matchesSidebarSearch, normalizeSidebarSearchQuery } from '@/utils/sidebarSearch'
import type { BranchInfo } from '@/types/git'

const { t } = useI18n()
const router = useRouter()
const historyStore = useHistoryStore()
const workspaceStore = useWorkspaceStore()
const repoStore = useRepoStore()
const uiStore = useUiStore()
const sectionState = useSidebarSectionState()
const activeRepoPath = computed(() => repoStore.activeRepo()?.path)
const activeRepoBranchScope = computed(() =>
  uiStore.getHistoryBranchScope(activeRepoPath.value),
)

const localBranches = computed(() => {
  const branches = historyStore.branches.filter((b) => !b.is_remote)
  if (workspaceStore.status?.is_detached) {
    const detachedBranch: BranchInfo = {
      name: 'HEAD',
      is_remote: false,
      is_head: true,
      upstream: undefined,
      commit_oid: workspaceStore.status.head_commit,
      ahead: 0,
      behind: 0
    }
    return [detachedBranch, ...branches]
  }
  return branches
})

const searchQuery = ref('')
const filteredLocalBranches = computed(() =>
  localBranches.value.filter((branch) => matchesSidebarSearch(searchQuery.value, branch.name)),
)
const hasSearchQuery = computed(() => !!normalizeSidebarSearchQuery(searchQuery.value))
const localBranchTree = computed(() => buildLocalBranchTree(filteredLocalBranches.value))

watch(() => repoStore.activeRepoId, () => {
  searchQuery.value = ''
})

function jumpToBranchCommit(commitOid: string) {
  historyStore.pendingJumpOid = commitOid
  router.push('/history')
}

function onSelectLocalBranch(branch: BranchInfo) {
  if (branch.commit_oid) jumpToBranchCommit(branch.commit_oid)
}

function onDblclickLocalBranch(branch: BranchInfo) {
  if (!branch.is_head) switchBranch(branch.name)
}

async function switchBranch(name: string) {
  try {
    await historyStore.switchBranch(name)
  } catch (e) {
    console.error(e)
  }
}

const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  branch: null as BranchInfo | null,
})

const contextMenuItems = computed<ContextMenuItem[]>(() => {
  const b = contextMenu.branch
  if (!b) return []
  const items: ContextMenuItem[] = []
  const isRealCurrentBranch = b.is_head && b.name !== 'HEAD'

  if (!b.is_head) {
    items.push({ label: t('sidebar.branch.menu.switchTo'), action: 'switch' })
    items.push({ label: t('sidebar.branch.menu.switchForce'), action: 'switch-force', danger: true })
  } else if (isRealCurrentBranch) {
    items.push({
      label:
        (activeRepoBranchScope.value === 'current_first_parent' ? '✓ ' : '   ') +
        t('sidebar.branch.menu.soloCurrentBranch'),
      action: 'toggle-solo-current',
    })
    items.push({ separator: true })
  }

  items.push({ label: t('sidebar.branch.menu.copyName'), action: 'copy-name' })

  if (!b.is_head) {
    items.push({ separator: true })
    items.push({ label: t('sidebar.branch.menu.delete'), action: 'delete', danger: true })
  }

  return items
})

function openContextMenu(e: MouseEvent, branch: BranchInfo) {
  e.preventDefault()
  contextMenu.branch = branch
  contextMenu.x = e.clientX
  contextMenu.y = e.clientY
  contextMenu.visible = true
}

function closeContextMenu() {
  contextMenu.visible = false
}

// Confirm Dialog
const confirmDlg = reactive({
  visible: false,
  title: '',
  message: '',
  loading: false,
  showCheckbox: false,
  checkboxLabel: '',
  checkboxValue: false,
  confirmLabel: '',
  loadingLabel: '',
  _resolve: null as (() => Promise<void>) | null,
})

function openConfirm(
  title: string,
  message: string,
  action: () => Promise<void>,
  options?: { checkboxLabel?: string; checkboxValue?: boolean; confirmLabel?: string; loadingLabel?: string },
) {
  confirmDlg.title = title
  confirmDlg.message = message
  confirmDlg._resolve = action
  confirmDlg.loading = false
  confirmDlg.showCheckbox = !!options?.checkboxLabel
  confirmDlg.checkboxLabel = options?.checkboxLabel || ''
  confirmDlg.checkboxValue = options?.checkboxValue || false
  confirmDlg.confirmLabel = options?.confirmLabel || ''
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

async function onContextAction(action: string) {
  const b = contextMenu.branch
  if (!b) return

  try {
    switch (action) {
      case 'switch':
      case 'switch-force': {
        const force = action === 'switch-force'
        if (force) {
          if (!confirm(t('sidebar.branch.confirmSwitchForce', { name: b.name }))) break
        }
        await historyStore.switchBranch(b.name, force)
        break
      }
      case 'copy-name':
        await navigator.clipboard.writeText(b.name)
        break
      case 'toggle-solo-current':
        if (b.is_head && b.name !== 'HEAD') {
          uiStore.toggleHistoryBranchScopeForRepo(activeRepoPath.value)
        }
        break
      case 'delete': {
        const hasUpstream = !!b.upstream
        
        openConfirm(
          t('sidebar.branch.menu.delete'),
          hasUpstream
            ? t('sidebar.branch.confirmDeleteWithRemote', { name: b.name, upstream: b.upstream })
            : t('sidebar.branch.confirmDelete', { name: b.name }),
          async () => {
            // 1. 删除本地
            await historyStore.deleteBranch(b.name)
            
            // 2. (可选) 删除远程
            if (confirmDlg.checkboxValue && b.upstream) {
              const slashIdx = b.upstream.indexOf('/')
              if (slashIdx > 0) {
                const remote = b.upstream.substring(0, slashIdx)
                const branch = b.upstream.substring(slashIdx + 1)
                await historyStore.deleteRemoteBranch(remote, branch)
              }
            }
          },
          {
            checkboxLabel: hasUpstream
              ? t('sidebar.branch.deleteLocalAndRemote', { upstream: b.upstream })
              : undefined,
            checkboxValue: false,
            loadingLabel: t('common.deleting', '删除中...'),
          },
        )
        break
      }
    }
  } catch (err) {
    console.error(err)
  }
}
</script>

<template>
  <div class="section" v-if="localBranches.length > 0 && repoStore.activeRepoId">
    <div class="section-title collapsible" @click="sectionState.toggle('local-branches')">
      <svg class="chevron" :class="{ open: !sectionState.isCollapsed('local-branches') }"
            width="10" height="10" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <span class="section-label">LOCAL BRANCHES</span>
      <span class="section-count">{{ hasSearchQuery ? filteredLocalBranches.length : localBranches.length }}</span>
      <SidebarSearchControl
        v-model="searchQuery"
        @open="sectionState.isCollapsed('local-branches') && sectionState.toggle('local-branches')"
      />
    </div>
    <template v-if="!sectionState.isCollapsed('local-branches')">
      <BranchTreeNode
        v-for="node in localBranchTree"
        :key="node.kind === 'folder' ? 'f:' + node.path : 'b:' + node.fullName"
        :node="node"
        :level="0"
        :show-local-status="true"
        :solo-current-branch="activeRepoBranchScope === 'current_first_parent'"
        :force-expanded="hasSearchQuery"
        @select-branch="onSelectLocalBranch"
        @dblclick-branch="onDblclickLocalBranch"
        @branch-context-menu="openContextMenu"
      />
      <div v-if="hasSearchQuery && filteredLocalBranches.length === 0" class="section-empty">
        {{ t('sidebar.search.noResults') }}
      </div>
    </template>

    <ContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenuItems"
      @close="closeContextMenu"
      @select="onContextAction"
    />

    <ConfirmDialog
      :visible="confirmDlg.visible"
      :title="confirmDlg.title"
      :message="confirmDlg.message"
      :loading="confirmDlg.loading"
      :danger="true"
      :confirm-label="confirmDlg.confirmLabel || (confirmDlg.showCheckbox ? t('common.confirm') : t('common.delete'))"
      :loading-label="confirmDlg.loadingLabel || undefined"
      :checkbox-label="confirmDlg.showCheckbox ? confirmDlg.checkboxLabel : undefined"
      v-model:checkbox-value="confirmDlg.checkboxValue"
      @confirm="onConfirmDialogConfirm"
      @cancel="onConfirmDialogCancel"
    />
  </div>
</template>

<style scoped>
@import './sidebar-common.css';
</style>
