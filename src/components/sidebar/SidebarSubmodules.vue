<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRepoStore } from '@/stores/repos'
import { useSubmodulesStore } from '@/stores/submodules'
import { useSidebarSectionState } from '@/composables/useSidebarSectionState'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import EditSubmoduleDialog from '@/components/submodule/EditSubmoduleDialog.vue'
import AddSubmoduleDialog from '@/components/submodule/AddSubmoduleDialog.vue'
import type { SubmoduleInfo } from '@/types/git'

const { t } = useI18n()
const repoStore = useRepoStore()
const submodulesStore = useSubmodulesStore()
const sectionState = useSidebarSectionState()

const submodules = computed(() => submodulesStore.submodules)

const addSubmoduleDlg = reactive({ visible: false })

function openAddSubmoduleDialog(e: MouseEvent) {
  e.stopPropagation()
  addSubmoduleDlg.visible = true
}

async function onAddSubmoduleSuccess() {
  await submodulesStore.loadSubmodules()
}

const submoduleMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  target: null as SubmoduleInfo | null,
})

const editDialog = reactive({
  visible: false,
  target: null as SubmoduleInfo | null,
})

const submoduleMenuItems = computed<ContextMenuItem[]>(() => {
  const s = submoduleMenu.target
  if (!s) return []
  const isInitialized = s.state !== 'uninitialized'
  return [
    {
      label: t('sidebar.submodule.menu.init', { path: s.path }),
      action: 'init',
      disabled: isInitialized,
    },
    { label: t('sidebar.submodule.menu.update', { path: s.path }), action: 'update' },
    { separator: true },
    { label: t('sidebar.submodule.menu.edit', { path: s.path }), action: 'edit' },
    { separator: true },
    { label: t('sidebar.submodule.menu.delete'), action: 'delete', danger: true },
  ]
})

function openSubmoduleMenu(e: MouseEvent, s: SubmoduleInfo) {
  e.preventDefault()
  e.stopPropagation()
  submoduleMenu.target = s
  const isRightClick = e.type === 'contextmenu'
  const el = e.currentTarget as HTMLElement | null
  if (el && !isRightClick) {
    const rect = el.getBoundingClientRect()
    submoduleMenu.x = rect.right
    submoduleMenu.y = rect.bottom
  } else {
    submoduleMenu.x = e.clientX
    submoduleMenu.y = e.clientY
  }
  submoduleMenu.visible = true
}

function closeSubmoduleMenu() {
  submoduleMenu.visible = false
}

// Confirm Dialog
const confirmDlg = reactive({
  visible: false,
  title: '',
  message: '',
  loading: false,
  confirmLabel: '',
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

async function onSubmoduleMenuAction(action: string) {
  const s = submoduleMenu.target
  if (!s) return
  try {
    switch (action) {
      case 'init':
        await submodulesStore.init(s.name)
        break
      case 'update':
        await submodulesStore.update(s.name)
        break
      case 'edit':
        editDialog.target = s
        editDialog.visible = true
        break
      case 'delete':
        openConfirm(
          t('submodule.confirmDelete.title'),
          t('submodule.confirmDelete.message', { path: s.path, name: s.name }),
          async () => {
            await submodulesStore.deinit(s.name)
          },
          {
            loadingLabel: t('common.deleting', '删除中...'),
          }
        )
        break
    }
  } catch (err) {
    console.error(err)
    alert(t('common.operationFailed', { detail: String(err) }))
  }
}

async function onSubmoduleClick(s: SubmoduleInfo) {
  if (s.state === 'uninitialized' || s.state === 'not_cloned' || s.state === 'not_found') {
    return
  }
  try {
    const absPath = await submodulesStore.workdir(s.name)
    await repoStore.openRepo(absPath)
  } catch (err) {
    console.error(err)
    alert(t('sidebar.submodule.openFailed', { detail: String(err) }))
  }
}
</script>

<template>
  <div class="section" v-if="repoStore.activeRepoId">
    <div class="section-title collapsible" @click="sectionState.toggle('submodules')">
      <svg class="chevron" :class="{ open: !sectionState.isCollapsed('submodules') }"
            width="10" height="10" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <span class="section-label">SUBMODULES</span>
      <span class="section-count">{{ submodules.length }}</span>
      <button
        class="section-add-btn"
        :title="t('sidebar.submodule.addButton')"
        @click.stop="openAddSubmoduleDialog"
      >+</button>
    </div>
    <template v-if="!sectionState.isCollapsed('submodules')">
      <div
        v-for="s in submodules"
        :key="s.name"
        class="submodule-item"
        :class="{
          'submodule-item--dim':
            s.state === 'uninitialized' || s.state === 'not_cloned' || s.state === 'not_found',
        }"
        :title="`${s.path}${s.url ? '\n' + s.url : ''}`"
        @click="onSubmoduleClick(s)"
        @contextmenu="openSubmoduleMenu($event, s)"
      >
        <svg
          v-if="s.state === 'uninitialized' || s.state === 'not_cloned' || s.state === 'not_found'"
          class="sub-warn"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <svg
          v-else
          class="sub-icon"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
          <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
        <span class="submodule-label">{{ s.path }}</span>
        <span v-if="s.has_workdir_modifications" class="sub-dot" :title="t('sidebar.submodule.hasChanges')" />
        <button
          class="submodule-kebab"
          :title="t('sidebar.submodule.menuTitle')"
          @click="openSubmoduleMenu($event, s)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.7"/>
            <circle cx="12" cy="12" r="1.7"/>
            <circle cx="12" cy="19" r="1.7"/>
          </svg>
        </button>
      </div>
    </template>

    <ContextMenu
      :visible="submoduleMenu.visible"
      :x="submoduleMenu.x"
      :y="submoduleMenu.y"
      :items="submoduleMenuItems"
      @close="closeSubmoduleMenu"
      @select="onSubmoduleMenuAction"
    />

    <EditSubmoduleDialog
      :visible="editDialog.visible"
      :submodule="editDialog.target"
      @close="editDialog.visible = false"
    />

    <AddSubmoduleDialog
      :visible="addSubmoduleDlg.visible"
      @close="addSubmoduleDlg.visible = false"
      @success="onAddSubmoduleSuccess"
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

.submodule-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 6px 3px 16px;
  font-size: var(--font-md);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s;
}

.submodule-item:hover {
  background: var(--bg-overlay);
}

.submodule-item--dim {
  color: var(--text-muted);
}

.sub-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.sub-warn {
  color: var(--accent-orange);
  flex-shrink: 0;
}

.submodule-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-orange);
  flex-shrink: 0;
}

.submodule-kebab {
  display: none;
  background: none;
  border: none;
  padding: 2px;
  border-radius: 3px;
  color: var(--text-muted);
  cursor: pointer;
}

.submodule-kebab:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.submodule-item:hover .submodule-kebab {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
