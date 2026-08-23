<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useHistoryStore } from '@/stores/history'
import { useRepoStore } from '@/stores/repos'
import { useStashStore } from '@/stores/stash'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { useSidebarSectionState } from '@/composables/useSidebarSectionState'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import SidebarSearchControl from './SidebarSearchControl.vue'
import { matchesSidebarSearch, normalizeSidebarSearchQuery } from '@/utils/sidebarSearch'
import type { StashEntry } from '@/types/git'

const { t } = useI18n()
const router = useRouter()
const historyStore = useHistoryStore()
const repoStore = useRepoStore()
const stashStore = useStashStore()
const workspaceStore = useWorkspaceStore()
const { showError, showActionError } = useGlobalToast()
const sectionState = useSidebarSectionState()
const searchQuery = ref('')
const filteredEntries = computed(() =>
  stashStore.entries.filter((entry) =>
    matchesSidebarSearch(searchQuery.value, String(entry.index), entry.message),
  ),
)
const hasSearchQuery = computed(() => !!normalizeSidebarSearchQuery(searchQuery.value))

interface PendingStashAction {
  kind: 'pop' | 'drop'
  repoId: string
  index: number
  message: string
  commitOid: string
  changeCount: number
}

const pendingAction = ref<PendingStashAction | null>(null)
const confirmationLoading = ref(false)

const confirmationTitle = computed(() => pendingAction.value?.kind === 'drop'
  ? t('sidebar.stash.confirmDropTitle')
  : t('sidebar.stash.confirmPopTitle'))

const confirmationMessage = computed(() => {
  const pending = pendingAction.value
  if (!pending) return ''
  const key = pending.kind === 'drop'
    ? 'sidebar.stash.confirmDrop'
    : 'sidebar.stash.confirmPop'
  return t(key, {
    index: pending.index,
    message: pending.message,
    count: pending.changeCount,
  })
})

function currentChangeCount(): number {
  const status = workspaceStore.status
  return new Set([
    ...(status?.staged ?? []),
    ...(status?.unstaged ?? []),
    ...(status?.untracked ?? []),
  ].map((file) => file.path)).size
}

function captureAction(kind: PendingStashAction['kind'], stash: StashEntry) {
  const repoId = repoStore.activeRepoId
  if (!repoId) return
  pendingAction.value = {
    kind,
    repoId,
    index: stash.index,
    message: stash.message,
    commitOid: stash.commit_oid,
    changeCount: currentChangeCount(),
  }
}

watch(
  () => repoStore.activeRepoId,
  (repoId) => {
    searchQuery.value = ''
    const pending = pendingAction.value
    if (!pending || pending.repoId === repoId || confirmationLoading.value) return
    pendingAction.value = null
    showError(t('sidebar.stash.contextChanged'))
  },
)

function jumpToBranchCommit(commitOid: string) {
  historyStore.pendingJumpOid = commitOid
  router.push('/history')
}

function onStashClick(commitOid: string) {
  jumpToBranchCommit(commitOid)
}

const stashMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  repoId: null as string | null,
  target: null as StashEntry | null,
})

const stashMenuItems = computed<ContextMenuItem[]>(() => {
  const s = stashMenu.target
  if (!s) return []
  return [
    { label: t('sidebar.stash.menu.apply'), action: 'apply' },
    { label: t('sidebar.stash.menu.pop'), action: 'pop' },
    { label: t('sidebar.stash.menu.delete'), action: 'delete' },
  ]
})

function openStashMenu(e: MouseEvent, s: StashEntry) {
  e.preventDefault()
  e.stopPropagation()
  stashMenu.target = s
  stashMenu.repoId = repoStore.activeRepoId
  stashMenu.x = e.clientX
  stashMenu.y = e.clientY
  stashMenu.visible = true
}

function closeStashMenu() {
  stashMenu.visible = false
}

async function onStashMenuAction(action: string) {
  const s = stashMenu.target
  const repoId = stashMenu.repoId
  if (!s || !repoId) return
  if (repoStore.activeRepoId !== repoId) {
    showError(t('sidebar.stash.contextChanged'))
    return
  }
  try {
    switch (action) {
      case 'apply':
        await stashStore.apply(repoId, s.index, s.commit_oid)
        break
      case 'pop':
        if (currentChangeCount() > 0) {
          captureAction('pop', s)
        } else {
          await stashStore.pop(repoId, s.index, s.commit_oid)
        }
        break
      case 'delete':
        captureAction('drop', s)
        break
    }
  } catch (err) {
    console.error(err)
    showActionError(err, t('common.operationFailed', { detail: String(err) }))
  }
}

async function confirmStashAction() {
  const pending = pendingAction.value
  if (!pending || confirmationLoading.value) return
  if (repoStore.activeRepoId !== pending.repoId) {
    pendingAction.value = null
    showError(t('sidebar.stash.contextChanged'))
    return
  }

  confirmationLoading.value = true
  try {
    if (pending.kind === 'pop') {
      await stashStore.pop(pending.repoId, pending.index, pending.commitOid)
    } else {
      await stashStore.drop(pending.repoId, pending.index, pending.commitOid)
    }
    pendingAction.value = null
  } catch (err) {
    console.error(err)
    pendingAction.value = null
    showActionError(err, t('common.operationFailed', { detail: String(err) }))
  } finally {
    confirmationLoading.value = false
  }
}

function cancelStashAction() {
  if (confirmationLoading.value) return
  pendingAction.value = null
}
</script>

<template>
  <div
    class="section"
    v-if="stashStore.entries.length > 0 && repoStore.activeRepoId"
  >
    <div class="section-title collapsible" @click="sectionState.toggle('stash')">
      <svg class="chevron" :class="{ open: !sectionState.isCollapsed('stash') }"
            width="10" height="10" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <span class="section-label">STASH</span>
      <span class="section-count">{{ hasSearchQuery ? filteredEntries.length : stashStore.entries.length }}</span>
      <SidebarSearchControl
        v-model="searchQuery"
        @open="sectionState.isCollapsed('stash') && sectionState.toggle('stash')"
      />
    </div>
    <template v-if="!sectionState.isCollapsed('stash')">
      <div
        v-for="s in filteredEntries"
        :key="s.index"
        class="branch-item stash-item"
        :title="s.message"
        @click="onStashClick(s.commit_oid)"
        @contextmenu="openStashMenu($event, s)"
      >
        <span class="branch-dot dot-outline" />
        <span class="stash-index">{{ '{' + s.index + '}' }}</span>
        <span class="branch-label">{{ s.message }}</span>
      </div>
      <div v-if="hasSearchQuery && filteredEntries.length === 0" class="section-empty">
        {{ t('sidebar.search.noResults') }}
      </div>
    </template>

    <ContextMenu
      :visible="stashMenu.visible"
      :x="stashMenu.x"
      :y="stashMenu.y"
      :items="stashMenuItems"
      @close="closeStashMenu"
      @select="onStashMenuAction"
    />

    <ConfirmDialog
      :visible="pendingAction !== null"
      :title="confirmationTitle"
      :message="confirmationMessage"
      :confirm-label="pendingAction?.kind === 'drop'
        ? t('sidebar.stash.dropConfirm')
        : t('sidebar.stash.popConfirm')"
      :loading-label="pendingAction?.kind === 'drop'
        ? t('sidebar.stash.dropping')
        : t('sidebar.stash.popping')"
      :danger="pendingAction?.kind === 'drop'"
      :loading="confirmationLoading"
      @confirm="confirmStashAction"
      @cancel="cancelStashAction"
    />
  </div>
</template>

<style scoped>
@import './sidebar-common.css';

.stash-item .branch-dot {
  border-color: var(--accent-orange, #f5a97f);
}

.stash-index {
  font-family: Menlo, 'SF Mono', monospace;
  font-size: var(--font-xs);
  color: var(--text-muted);
  flex-shrink: 0;
}

.stash-item .branch-label {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
