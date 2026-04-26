<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useHistoryStore } from '@/stores/history'
import { useRepoStore } from '@/stores/repos'
import { useSidebarSectionState } from '@/composables/useSidebarSectionState'
import { usePickRemote } from '@/composables/usePickRemote'
import { useGitCommands } from '@/composables/useGitCommands'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import type { TagInfo } from '@/types/git'

const { t } = useI18n()
const router = useRouter()
const historyStore = useHistoryStore()
const repoStore = useRepoStore()
const sectionState = useSidebarSectionState()
const { pickRemote } = usePickRemote()
const git = useGitCommands()

const tags = computed(() => historyStore.tags)

type TagRemoteStatus = 'synced' | 'local_only' | 'unknown'
function tagRemoteStatus(tag: TagInfo): TagRemoteStatus {
  if (!historyStore.remoteTagsChecked) return 'unknown'
  return historyStore.remoteTagNames.has(tag.name) ? 'synced' : 'local_only'
}
function tagStatusLabel(status: TagRemoteStatus): string {
  switch (status) {
    case 'synced':
      return t('history.tag.status.synced')
    case 'local_only':
      return t('history.tag.status.localOnly')
    default:
      return t('history.tag.status.unknown')
  }
}
function tagItemTitle(tag: TagInfo): string {
  const base = tag.is_annotated && tag.message
    ? `${tag.name}\n\n${tag.message}`
    : tag.name
  return `${base}\n[${tagStatusLabel(tagRemoteStatus(tag))}]`
}

function jumpToBranchCommit(commitOid: string) {
  historyStore.pendingJumpOid = commitOid
  router.push('/history')
}

const tagMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  target: null as TagInfo | null,
  isSection: false,
})

const tagMenuItems = computed<ContextMenuItem[]>(() => {
  if (tagMenu.isSection) {
    return [
      { label: t('toolbar.opLabels.fetch', 'Fetch') + ' Tags', action: 'fetch-tags' }
    ]
  }
  const tag = tagMenu.target
  if (!tag) return []
  const items: ContextMenuItem[] = [
    { label: t('sidebar.tag.menu.copyName'), action: 'copy-name' },
    { label: t('sidebar.tag.menu.copyOid'), action: 'copy-oid' },
    { separator: true },
    { label: t('sidebar.tag.menu.push'), action: 'push' },
    { label: t('sidebar.tag.menu.pushForce'), action: 'push-force', danger: true },
    { separator: true },
    { label: t('sidebar.tag.menu.delete'), action: 'delete', danger: true },
  ]
  const isSynced = historyStore.remoteTagNames.has(tag.name)
  if (isSynced) {
    items.push({ label: t('sidebar.tag.menu.deleteRemote'), action: 'delete-remote', danger: true })
  }
  return items
})

function openTagSectionMenu(e: MouseEvent) {
  e.preventDefault()
  tagMenu.target = null
  tagMenu.isSection = true
  tagMenu.x = e.clientX
  tagMenu.y = e.clientY
  tagMenu.visible = true
}

function openTagMenu(e: MouseEvent, tag: TagInfo) {
  e.preventDefault()
  tagMenu.target = tag
  tagMenu.isSection = false
  tagMenu.x = e.clientX
  tagMenu.y = e.clientY
  tagMenu.visible = true
}

function closeTagMenu() {
  tagMenu.visible = false
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

async function onTagMenuAction(action: string) {
  try {
    if (action === 'fetch-tags') {
      const id = repoStore.activeRepoId
      if (!id) return
      const remote = await pickRemote(id)
      if (!remote) return
      await git.fetchTagsFromRemote(id, remote)
      await historyStore.loadTags()
      historyStore.loadRemoteTags(true).catch(() => {})
      return
    }

    const tag = tagMenu.target
    if (!tag) return

    switch (action) {
      case 'copy-name':
        await navigator.clipboard.writeText(tag.name)
        break
      case 'copy-oid':
        await navigator.clipboard.writeText(tag.commit_oid)
        break
      case 'push':
      case 'push-force': {
        const id = repoStore.activeRepoId
        if (!id) break
        const remote = await pickRemote(id)
        if (!remote) break
        const force = action === 'push-force'
        if (force) {
          if (!confirm(t('sidebar.tag.confirmPushForce', { name: tag.name }))) break
        }
        await git.pushTag(id, remote, tag.name, force)
        historyStore.markTagPushed(tag.name)
        break
      }
      case 'delete': {
        const isSynced = historyStore.remoteTagNames.has(tag.name)
        openConfirm(
          t('sidebar.tag.menu.delete'),
          isSynced
            ? t('sidebar.tag.confirmDeleteWithRemote', { name: tag.name })
            : t('sidebar.tag.confirmDelete', { name: tag.name }),
          async () => {
            const deleteRemote = confirmDlg.checkboxValue
            await historyStore.deleteTag(tag.name)

            if (deleteRemote) {
              const id = repoStore.activeRepoId
              if (!id) return
              const remote = await pickRemote(id)
              if (remote) {
                await historyStore.deleteRemoteTag(tag.name, remote)
              }
            }
          },
          {
            checkboxLabel: isSynced ? t('sidebar.tag.deleteLocalAndRemote') : undefined,
            checkboxValue: false,
            loadingLabel: t('common.deleting', '删除中...'),
          },
        )
        break
      }
      case 'delete-remote': {
        openConfirm(
          t('sidebar.tag.menu.deleteRemote'),
          t('sidebar.tag.confirmDeleteRemote', { name: tag.name }),
          async () => {
            const id = repoStore.activeRepoId
            if (!id) return
            const remote = await pickRemote(id)
            if (remote) {
              await historyStore.deleteRemoteTag(tag.name, remote)
            }
          },
          {
            confirmLabel: t('sidebar.tag.menu.deleteRemote'),
            loadingLabel: t('common.deleting', '删除中...'),
          }
        )
        break
      }
    }
  } catch (err) {
    console.error(err)
    alert(t('common.operationFailed', { detail: String(err) }))
  }
}
</script>

<template>
  <div class="section" v-if="tags.length > 0 && repoStore.activeRepoId">
    <div class="section-title collapsible" @click="sectionState.toggle('tags')" @contextmenu="openTagSectionMenu">
      <svg class="chevron" :class="{ open: !sectionState.isCollapsed('tags') }"
            width="10" height="10" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <span class="section-label">TAGS</span>
      <span class="section-count">{{ tags.length }}</span>
    </div>
    <template v-if="!sectionState.isCollapsed('tags')">
      <div
        v-for="tag in tags"
        :key="tag.name"
        class="branch-item tag-item"
        :class="{ 'tag-item--lightweight': !tag.is_annotated }"
        :title="tagItemTitle(tag)"
        @click="jumpToBranchCommit(tag.commit_oid)"
        @contextmenu="openTagMenu($event, tag)"
      >
        <svg
          class="tag-icon"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
          <line x1="7" y1="7" x2="7.01" y2="7"/>
        </svg>
        <span class="branch-label">{{ tag.name }}</span>
        <span
          v-if="tagRemoteStatus(tag) === 'synced'"
          class="tag-status-icon tag-status-icon--synced"
          aria-hidden="true"
        >✓</span>
        <span
          v-else-if="tagRemoteStatus(tag) === 'local_only'"
          class="tag-status-icon tag-status-icon--local"
          aria-hidden="true"
        >↑</span>
      </div>
    </template>

    <ContextMenu
      :visible="tagMenu.visible"
      :x="tagMenu.x"
      :y="tagMenu.y"
      :items="tagMenuItems"
      @close="closeTagMenu"
      @select="onTagMenuAction"
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

.tag-icon {
  color: var(--accent-orange);
  flex-shrink: 0;
}

.tag-item--lightweight .tag-icon {
  color: var(--text-muted);
}

.tag-item .tag-status-icon {
  margin-left: auto;
  padding-left: 4px;
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
  flex-shrink: 0;
}
.tag-item .tag-status-icon--synced {
  color: var(--accent-green);
}
.tag-item .tag-status-icon--local {
  color: var(--accent-orange);
}
</style>
