<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useHistoryStore } from '@/stores/history'
import { useRepoStore } from '@/stores/repos'
import { useStashStore } from '@/stores/stash'
import { useSidebarSectionState } from '@/composables/useSidebarSectionState'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import SidebarSearchControl from './SidebarSearchControl.vue'
import { matchesSidebarSearch, normalizeSidebarSearchQuery } from '@/utils/sidebarSearch'
import type { StashEntry } from '@/types/git'

const { t } = useI18n()
const router = useRouter()
const historyStore = useHistoryStore()
const repoStore = useRepoStore()
const stashStore = useStashStore()
const sectionState = useSidebarSectionState()
const searchQuery = ref('')
const filteredEntries = computed(() =>
  stashStore.entries.filter((entry) =>
    matchesSidebarSearch(searchQuery.value, String(entry.index), entry.message),
  ),
)
const hasSearchQuery = computed(() => !!normalizeSidebarSearchQuery(searchQuery.value))

watch(() => repoStore.activeRepoId, () => {
  searchQuery.value = ''
})

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
  stashMenu.x = e.clientX
  stashMenu.y = e.clientY
  stashMenu.visible = true
}

function closeStashMenu() {
  stashMenu.visible = false
}

async function onStashMenuAction(action: string) {
  const s = stashMenu.target
  if (!s) return
  try {
    switch (action) {
      case 'apply':
        await stashStore.apply(s.index)
        break
      case 'pop':
        await stashStore.pop(s.index)
        break
      case 'delete':
        if (confirm(t('sidebar.stash.confirmDelete', { index: s.index, message: s.message }))) {
          await stashStore.drop(s.index)
        }
        break
    }
  } catch (err) {
    console.error(err)
    alert(t('common.operationFailed', { detail: String(err) }))
  }
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
