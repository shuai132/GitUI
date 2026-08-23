<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRepoStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { useErrorsStore } from '@/stores/errors'
import { useRepoOpsStore } from '@/stores/repoOps'
import { useTerminalStore } from '@/stores/terminal'
import { useSettingsStore } from '@/stores/settings'
import { usePluginsStore } from '@/stores/plugins'
import { useWorkspaceStore } from '@/stores/workspace'
import { useHistoryStore } from '@/stores/history'
import { useShortcutsStore, bindingToLabel, type ShortcutActionId } from '@/stores/shortcuts'
import { useGitCommands } from '@/composables/useGitCommands'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { useBlurOnOutsidePointerDown } from '@/composables/useBlurOnOutsidePointerDown'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'

const emit = defineEmits<{
  (e: 'show-reflog'): void
  (e: 'show-error-history'): void
  (e: 'show-settings'): void
  (e: 'show-about'): void
}>()

const repoStore = useRepoStore()
const uiStore = useUiStore()
const errorsStore = useErrorsStore()
const repoOpsStore = useRepoOpsStore()
const terminalStore = useTerminalStore()
const settingsStore = useSettingsStore()
const pluginsStore = usePluginsStore()
const workspaceStore = useWorkspaceStore()
const historyStore = useHistoryStore()
const shortcutsStore = useShortcutsStore()
const git = useGitCommands()
const { t } = useI18n()
const { showToast } = useGlobalToast()

function withShortcut(label: string, actionId: ShortcutActionId): string {
  const b = shortcutsStore.bindings[actionId]
  return b ? `${label} (${bindingToLabel(b)})` : label
}

const hasRepo = computed(() => !!repoStore.activeRepoId)
const busy = computed(() => repoOpsStore.getBusy(repoStore.activeRepoId))
const activeRepoPath = computed(() => repoStore.activeRepo()?.path)
const activeRepoBranchScope = computed(() =>
  uiStore.getHistoryBranchScope(activeRepoPath.value),
)

onMounted(() => {
  if (!pluginsStore.loaded) {
    pluginsStore.load().catch(() => {})
  }
})

// ── Search ──────────────────────────────────────────────────────────
const searchBoxEl = ref<HTMLElement | null>(null)
const searchInputEl = ref<HTMLInputElement | null>(null)
const searchExpanded = ref(false)

watch(() => uiStore.openSearchSignal, () => {
  expandSearch()
})

function expandSearch() {
  searchExpanded.value = true
  setTimeout(() => searchInputEl.value?.focus(), 0)
}

function onSearchBlur() {
  if (!uiStore.historySearchQuery) {
    searchExpanded.value = false
  }
}

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    clearSearch()
  }
}

function clearSearch() {
  uiStore.historySearchQuery = ''
  searchExpanded.value = false
  searchInputEl.value?.blur()
}

useBlurOnOutsidePointerDown(searchBoxEl, () => {
  if (!uiStore.historySearchQuery) {
    searchExpanded.value = false
  }
})

// ── Theme ───────────────────────────────────────────────────────────
const resolvedTheme = computed<'light' | 'dark'>(() => {
  return settingsStore.resolvedTheme
})

function toggleTheme() {
  settingsStore.themeMode = resolvedTheme.value === 'dark' ? 'light' : 'dark'
}

// ── Terminal Toggle ─────────────────────────────────────────────────
function onToggleInAppTerminal() {
  terminalStore.toggleActiveRepoVisible().catch((err: unknown) => {
    showToast('error', String(err))
  })
}

// ── Actions ─────────────────────────────────────────────────────────
const actionsMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
})
const actionsBtnRef = ref<HTMLButtonElement | null>(null)
const pendingGc = ref<{ repoId: string; repoName: string } | null>(null)
const gcConfirmLoading = computed(() => {
  const repoId = pendingGc.value?.repoId
  return repoId ? repoOpsStore.getBusy(repoId).gc : false
})

function cancelGc() {
  if (gcConfirmLoading.value) return
  pendingGc.value = null
}

async function confirmGc() {
  const pending = pendingGc.value
  if (!pending || gcConfirmLoading.value) return
  if (repoStore.activeRepoId !== pending.repoId) {
    pendingGc.value = null
    showToast('error', t('toolbar.gcConfirm.contextChanged'))
    return
  }
  repoOpsStore.setBusy(pending.repoId, 'gc', true)
  try {
    await git.runGc(pending.repoId)
    showToast('success', t('toolbar.gcConfirm.success', { repo: pending.repoName }))
    pendingGc.value = null
  } catch {
    // error toast handled globally
  } finally {
    repoOpsStore.setBusy(pending.repoId, 'gc', false)
  }
}

const actionsMenuItems = computed<ContextMenuItem[]>(() => {
  const items: ContextMenuItem[] = [
    {
      label:
        (activeRepoBranchScope.value === 'current_first_parent' ? '✓ ' : '   ') +
        t('toolbar.actionsMenu.soloCurrentBranch'),
      action: 'toggle-current-first-parent',
      disabled: !hasRepo.value,
    },
    {
      label:
        (uiStore.showRemoteBranches ? '✓ ' : '   ') +
        t('toolbar.actionsMenu.showRemoteBranches'),
      action: 'toggle-remote-branches',
      disabled: !hasRepo.value,
    },
    {
      label:
        (uiStore.showChangeStatsColumn ? '✓ ' : '   ') +
        t('toolbar.actionsMenu.showChangeStatsColumn'),
      action: 'toggle-change-stats-column',
      disabled: !hasRepo.value,
    },
    {
      label:
        (uiStore.diffHighlightEnabled ? '✓ ' : '   ') +
        t('toolbar.actionsMenu.syntaxHighlight'),
      action: 'toggle-diff-highlight',
      disabled: !hasRepo.value,
    },
    { separator: true },
    {
      label:
        (uiStore.showUnreachableCommits ? '✓ ' : '   ') +
        t('toolbar.actionsMenu.showUnreachable'),
      action: 'toggle-unreachable',
      disabled: !hasRepo.value,
    },
    {
      label: (uiStore.showStashCommits ? '✓ ' : '   ') + t('toolbar.actionsMenu.showStashes'),
      action: 'toggle-stashes',
      disabled: !hasRepo.value,
    },
    {
      label: (uiStore.debugPanelVisible ? '✓ ' : '   ') + t('toolbar.actionsMenu.debugLog'),
      action: 'toggle-debug',
    },
    { separator: true },
    {
      label: t('toolbar.actionsMenu.reflog'),
      action: 'reflog',
      disabled: !hasRepo.value,
    },
    {
      label:
        errorsStore.entries.length > 0
          ? t('toolbar.actionsMenu.recentErrorsWithCount', { count: errorsStore.entries.length })
          : t('toolbar.actionsMenu.recentErrors'),
      action: 'error-history',
      disabled: errorsStore.entries.length === 0,
    },
    {
      label: busy.value.gc ? t('toolbar.actionsMenu.gcCleaning') : t('toolbar.actionsMenu.gc'),
      action: 'gc',
      disabled: !hasRepo.value || busy.value.gc,
    },
  ]

  if (pluginsStore.toolbarCommands.length > 0) {
    items.push(
      { separator: true },
      {
        label: t('settings.plugins.actionGroup'),
        children: pluginsStore.toolbarCommands.map((command) => ({
          label: command.label,
          action: `plugin:${command.plugin_id}:${command.command_id}`,
          disabled: !hasRepo.value || pluginsStore.executing !== null,
          title: command.description,
        })),
      },
    )
  }

  items.push(
    { separator: true },
    {
      label: t('toolbar.actionsMenu.discardAll'),
      action: 'discard-all',
      disabled: !hasRepo.value,
    },
    { separator: true },
    {
      label: t('toolbar.actionsMenu.about'),
      action: 'about',
    },
  )

  return items
})

function onActions() {
  if (actionsMenu.visible) {
    actionsMenu.visible = false
    return
  }
  const el = actionsBtnRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  actionsMenu.x = rect.right - 200
  actionsMenu.y = rect.bottom + 4
  actionsMenu.visible = true
}

async function onActionsSelect(action: string) {
  actionsMenu.visible = false
  const id = repoStore.activeRepoId
  if (!id) return
  if (action.startsWith('plugin:')) {
    const payload = action.slice('plugin:'.length)
    const separator = payload.indexOf(':')
    const pluginId = separator >= 0 ? payload.slice(0, separator) : ''
    const commandId = separator >= 0 ? payload.slice(separator + 1) : ''
    if (!pluginId || !commandId) return
    try {
      const result = await pluginsStore.execute(pluginId, commandId)
      if (result.message) showToast('success', result.message)
      if (result.refresh.includes('workspace')) await workspaceStore.refresh()
      if (result.refresh.includes('history')) await historyStore.loadLog()
      if (result.refresh.includes('branches')) await historyStore.loadBranches()
    } catch {
      // error toast handled globally
    }
    return
  }
  switch (action) {
    case 'reflog':
      emit('show-reflog')
      break
    case 'gc': {
      const repo = repoStore.activeRepo()
      pendingGc.value = { repoId: id, repoName: repo?.name ?? id }
      break
    }
    case 'error-history':
      emit('show-error-history')
      break
    case 'discard-all':
      uiStore.requestDiscardAll()
      break
    case 'about':
      emit('show-about')
      break
    case 'toggle-unreachable':
      uiStore.toggleShowUnreachable()
      break
    case 'toggle-stashes':
      uiStore.toggleShowStashes()
      break
    case 'toggle-current-first-parent':
      uiStore.toggleHistoryBranchScopeForRepo(activeRepoPath.value)
      break
    case 'toggle-remote-branches':
      uiStore.toggleShowRemoteBranches()
      break
    case 'toggle-change-stats-column':
      uiStore.toggleShowChangeStatsColumn()
      break
    case 'toggle-diff-highlight':
      uiStore.toggleDiffHighlight()
      break
    case 'toggle-debug':
      uiStore.toggleDebugPanel()
      break
  }
}
</script>

<template>
  <div class="toolbar-right">
    <div
      v-if="hasRepo"
      ref="searchBoxEl"
      class="search-box"
      :class="{ 'search-box--expanded': searchExpanded || uiStore.historySearchQuery }"
    >
      <button
        type="button"
        class="search-icon-btn"
        :title="withShortcut(t('toolbar.title.search'), 'search')"
        :aria-label="withShortcut(t('toolbar.title.search'), 'search')"
        :aria-expanded="searchExpanded || !!uiStore.historySearchQuery"
        aria-controls="history-search-input"
        @click="expandSearch"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      </button>
      <input
        id="history-search-input"
        v-show="searchExpanded || uiStore.historySearchQuery"
        ref="searchInputEl"
        v-model="uiStore.historySearchQuery"
        class="search-input"
        :placeholder="t('toolbar.search.placeholder')"
        spellcheck="false"
        autocomplete="off"
        @blur="onSearchBlur"
        @keydown="onSearchKeydown"
      />
      <button
        v-show="uiStore.historySearchQuery"
        class="search-clear-btn"
        tabindex="-1"
        @mousedown.prevent
        @click="clearSearch"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- 主题切换 -->
    <button
      class="btn-icon-only"
      :title="resolvedTheme === 'dark' ? t('toolbar.title.themeSwitchLight') : t('toolbar.title.themeSwitchDark')"
      @click="toggleTheme"
    >
      <svg v-if="resolvedTheme === 'dark'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4"/>
        <line x1="12" y1="2" x2="12" y2="4"/>
        <line x1="12" y1="20" x2="12" y2="22"/>
        <line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/>
        <line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/>
        <line x1="2" y1="12" x2="4" y2="12"/>
        <line x1="20" y1="12" x2="22" y2="12"/>
        <line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/>
        <line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/>
      </svg>
      <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    </button>

    <!-- Terminal Toggle -->
    <button
      v-if="hasRepo"
      class="btn-icon-only"
      :class="{ 'btn-icon-only--active': terminalStore.activeRepoVisible }"
      :title="withShortcut(terminalStore.activeRepoVisible ? t('toolbar.title.terminalToggleHide') : t('toolbar.title.terminalToggleShow'), 'toggleTerminal')"
      @click="onToggleInAppTerminal"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="4 17 10 11 4 5"/>
        <line x1="12" y1="19" x2="20" y2="19"/>
      </svg>
    </button>

    <!-- Layout Switch -->
    <button
      v-if="hasRepo"
      class="btn-icon-only"
      :title="withShortcut(({ custom: t('toolbar.title.layoutCustom'), vertical: t('toolbar.title.layoutVertical'), horizontal: t('toolbar.title.layoutHorizontal') })[uiStore.layoutPreset], 'toggleDiffLayout')"
      @click="uiStore.toggleHistoryLayout()"
    >
      <svg v-if="uiStore.layoutPreset === 'custom'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="2" y="2" width="12" height="12" rx="1"/>
        <line x1="8" y1="2" x2="8" y2="14"/>
        <line x1="2" y1="8" x2="14" y2="8"/>
      </svg>
      <svg v-else-if="uiStore.layoutPreset === 'vertical'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="2" y="2" width="12" height="12" rx="1"/>
        <line x1="2" y1="8" x2="14" y2="8"/>
      </svg>
      <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="2" y="2" width="12" height="12" rx="1"/>
        <line x1="8" y1="2" x2="8" y2="14"/>
      </svg>
    </button>

    <!-- Settings -->
    <button
      class="btn-icon-only"
      :title="withShortcut(t('toolbar.title.settings'), 'openSettings')"
      @click="emit('show-settings')"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </button>

    <!-- Actions Menu -->
    <button
      ref="actionsBtnRef"
      class="btn-icon-only"
      :title="t('toolbar.title.actions')"
      :disabled="!hasRepo"
      data-menu-anchor
      @mousedown.stop
      @click="onActions"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="1"/>
        <circle cx="19" cy="12" r="1"/>
        <circle cx="5" cy="12" r="1"/>
      </svg>
    </button>

    <ContextMenu
      :visible="actionsMenu.visible"
      :x="actionsMenu.x"
      :y="actionsMenu.y"
      :items="actionsMenuItems"
      @close="actionsMenu.visible = false"
      @select="onActionsSelect"
    />

    <ConfirmDialog
      :visible="pendingGc !== null"
      :title="t('toolbar.gcConfirm.title')"
      :message="t('toolbar.gcConfirm.message', { repo: pendingGc?.repoName ?? '' })"
      :confirm-label="t('toolbar.gcConfirm.confirm')"
      :loading-label="t('toolbar.gcConfirm.running')"
      :loading="gcConfirmLoading"
      danger
      @confirm="confirmGc"
      @cancel="cancelGc"
    />
  </div>
</template>

<style scoped>
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.search-box {
  display: flex;
  align-items: center;
  border-radius: 4px;
  overflow: hidden;
  transition: width 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  width: 26px;
  border: 1px solid transparent;
  background: transparent;
}

.search-box--expanded {
  width: 136px;
  border-color: var(--border);
  background: var(--bg-surface);
  padding-right: 6px;
}

.search-icon-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  border-radius: 4px;
  padding: 0;
  transition: color 0.15s;
}

.search-icon-btn:hover {
  color: var(--text-primary);
}

.search-box--expanded .search-icon-btn {
  cursor: default;
}

.search-input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: var(--font-sm);
  font-family: inherit;
  outline: none;
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-clear-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-right: 4px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  border-radius: 50%;
  padding: 0;
  transition: color 0.15s, background 0.15s;
}

.search-clear-btn:hover {
  color: var(--text-primary);
  background: var(--bg-overlay);
}

.btn-icon-only {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 5px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: background 0.15s, color 0.15s;
}

.btn-icon-only:hover:not(:disabled) {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.btn-icon-only--active {
  background: var(--bg-overlay);
  color: var(--accent-blue);
}

.btn-icon-only:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
