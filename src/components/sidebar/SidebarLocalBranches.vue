<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useHistoryStore } from '@/stores/history'
import { useWorkspaceStore } from '@/stores/workspace'
import { useRepoStore } from '@/stores/repos'
import { useSidebarSectionState } from '@/composables/useSidebarSectionState'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import type { BranchInfo } from '@/types/git'

const { t } = useI18n()
const router = useRouter()
const historyStore = useHistoryStore()
const workspaceStore = useWorkspaceStore()
const repoStore = useRepoStore()
const sectionState = useSidebarSectionState()

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

function jumpToBranchCommit(commitOid: string) {
  historyStore.pendingJumpOid = commitOid
  router.push('/history')
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

  if (!b.is_head) {
    items.push({ label: t('sidebar.branch.menu.switchTo'), action: 'switch' })
    items.push({ label: t('sidebar.branch.menu.switchForce'), action: 'switch-force', danger: true })
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
      case 'delete': {
        const hasUpstream = !!b.upstream
        
        openConfirm(
          t('sidebar.branch.menu.delete'),
          hasUpstream
            ? t('sidebar.branch.confirmDeleteWithRemote', { name: b.name })
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
            checkboxLabel: hasUpstream ? t('sidebar.branch.deleteLocalAndRemote') : undefined,
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
      <span class="section-count">{{ localBranches.length }}</span>
    </div>
    <template v-if="!sectionState.isCollapsed('local-branches')">
      <div
        v-for="b in localBranches"
        :key="b.name"
        class="branch-item"
        :class="{ 'branch-item--current': b.is_head }"
        @click="b.commit_oid && jumpToBranchCommit(b.commit_oid)"
        @dblclick.stop="!b.is_head && switchBranch(b.name)"
        @contextmenu="openContextMenu($event, b)"
      >
        <span class="branch-dot" :class="b.is_head ? 'dot-solid' : 'dot-outline'" />
        <span class="branch-label">{{ b.name }}</span>
        <span
          v-if="(b.ahead ?? 0) > 0 || (b.behind ?? 0) > 0"
          class="ahead-behind"
        >
          <span v-if="(b.ahead ?? 0) > 0" class="ab-ahead">↑{{ b.ahead }}</span>
          <span v-if="(b.behind ?? 0) > 0" class="ab-behind">↓{{ b.behind }}</span>
        </span>
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

.ahead-behind {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-xs);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  background: var(--bg-overlay);
  padding: 1px 5px;
  border-radius: 7px;
  line-height: 1.4;
}

.ab-ahead {
  color: var(--accent-green);
}

.ab-behind {
  color: var(--accent-orange);
}
</style>
