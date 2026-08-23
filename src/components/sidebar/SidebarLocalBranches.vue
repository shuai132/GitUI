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
import BranchSwitchDialog from '@/components/branch/BranchSwitchDialog.vue'
import BranchTreeNode from './BranchTreeNode.vue'
import SidebarSearchControl from './SidebarSearchControl.vue'
import { useBranchSwitch } from '@/composables/useBranchSwitch'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { matchesSidebarSearch, normalizeSidebarSearchQuery } from '@/utils/sidebarSearch'
import type { BranchInfo } from '@/types/git'

const { t } = useI18n()
const router = useRouter()
const historyStore = useHistoryStore()
const workspaceStore = useWorkspaceStore()
const repoStore = useRepoStore()
const uiStore = useUiStore()
const sectionState = useSidebarSectionState()
const branchSwitch = reactive(useBranchSwitch())
const { copyText } = useClipboardFeedback(t)
const { showActionError } = useGlobalToast()
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
  if (!branch.is_head) void switchBranch(branch.name)
}

async function switchBranch(name: string) {
  try {
    await branchSwitch.requestSwitch(name)
  } catch (caught: unknown) {
    showActionError(caught, t('sidebar.branch.switchFailed', { detail: String(caught) }))
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

  if (!b.is_head && b.commit_oid) {
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
    showActionError(err, t('common.operationFailed', { detail: String(err) }))
  } finally {
    confirmDlg.loading = false
    confirmDlg.visible = false
  }
}

function onConfirmDialogCancel() {
  confirmDlg.visible = false
}

function shortOid(oid: string): string {
  return oid.slice(0, 7)
}

function isCurrentBranch(repoId: string, name: string, expectedOid: string): boolean {
  if (repoStore.activeRepoId !== repoId) return false
  return historyStore.branches.some(
    (current) => !current.is_remote &&
      current.name === name &&
      current.commit_oid === expectedOid,
  )
}

async function onContextAction(action: string) {
  const b = contextMenu.branch
  if (!b) return

  try {
    switch (action) {
      case 'switch': {
        await switchBranch(b.name)
        break
      }
      case 'copy-name':
        await copyText(b.name)
        break
      case 'toggle-solo-current':
        if (b.is_head && b.name !== 'HEAD') {
          uiStore.toggleHistoryBranchScopeForRepo(activeRepoPath.value)
        }
        break
      case 'delete': {
        const repoId = repoStore.activeRepoId
        const localOid = b.commit_oid
        if (!repoId || !localOid) break
        const upstreamBranch = b.upstream
          ? historyStore.branches.find(
              (branch) => branch.is_remote && branch.name === b.upstream && branch.commit_oid,
            )
          : undefined
        const upstreamOid = upstreamBranch?.commit_oid

        openConfirm(
          t('sidebar.branch.menu.delete'),
          upstreamBranch && upstreamOid
            ? t('sidebar.branch.confirmDeleteWithRemote', {
                name: b.name,
                oid: shortOid(localOid),
                upstream: upstreamBranch.name,
                upstreamOid: shortOid(upstreamOid),
              })
            : b.upstream
              ? t('sidebar.branch.confirmDeleteGoneUpstream', {
                  name: b.name,
                  oid: shortOid(localOid),
                  upstream: b.upstream,
                })
              : t('sidebar.branch.confirmDelete', {
                  name: b.name,
                  oid: shortOid(localOid),
                }),
          async () => {
            if (!isCurrentBranch(repoId, b.name, localOid)) {
              throw new Error(t('sidebar.branch.deleteContextChanged'))
            }
            if (confirmDlg.checkboxValue && upstreamBranch && upstreamOid) {
              const slashIdx = upstreamBranch.name.indexOf('/')
              if (slashIdx > 0) {
                const remote = upstreamBranch.name.substring(0, slashIdx)
                const branch = upstreamBranch.name.substring(slashIdx + 1)
                await historyStore.deleteRemoteBranch(
                  remote,
                  branch,
                  upstreamOid,
                )
              }
            }
            if (!isCurrentBranch(repoId, b.name, localOid)) {
              throw new Error(t('sidebar.branch.deleteContextChanged'))
            }
            await historyStore.deleteBranch(b.name, localOid)
          },
          {
            checkboxLabel: upstreamBranch && upstreamOid
              ? t('sidebar.branch.deleteLocalAndRemote', {
                  upstream: upstreamBranch.name,
                  oid: shortOid(upstreamOid),
                })
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

    <BranchSwitchDialog
      :visible="branchSwitch.dialogVisible"
      :source-branch="branchSwitch.sourceBranch"
      :target-branch="branchSwitch.targetBranch"
      :change-count="branchSwitch.changeCount"
      :loading="branchSwitch.loading"
      :active-mode="branchSwitch.activeMode"
      :changes-stashed="branchSwitch.changesStashed"
      :changes-discarded="branchSwitch.changesDiscarded"
      :error="branchSwitch.error"
      @confirm="branchSwitch.confirmSwitch"
      @cancel="branchSwitch.cancelSwitch"
    />
  </div>
</template>

<style scoped>
@import './sidebar-common.css';
</style>
