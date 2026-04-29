<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  DEFAULT_ADVANCED_VIEW_PREFS,
  useUiStore,
  type DiffLayoutMode,
} from '@/stores/ui'
import { useGitPrefsStore, FETCH_INTERVAL_OPTIONS } from '@/stores/gitPrefs'
import { useGitCommands } from '@/composables/useGitCommands'

const uiStore = useUiStore()
const gitPrefsStore = useGitPrefsStore()
const git = useGitCommands()
const { t } = useI18n()

const diffLayoutOptions = computed<Array<{ value: DiffLayoutMode; label: string }>>(() => [
  { value: 'inline', label: t('settings.advanced.diffLayoutInline') },
  { value: 'side-by-side', label: t('settings.advanced.diffLayoutSideBySide') },
])

interface ToggleRow {
  key: string
  label: string
  hint: string
  get: () => boolean
  toggle: () => void
}

const viewToggles = computed<ToggleRow[]>(() => [
  {
    key: 'diffGroupByHunk',
    label: t('settings.advanced.diffGroupByHunk'),
    hint: t('settings.advanced.diffGroupByHunkHint'),
    get: () => uiStore.diffGroupByHunk,
    toggle: () => uiStore.toggleDiffGroupByHunk(),
  },
  {
    key: 'showRemoteBranches',
    label: t('settings.advanced.showRemoteBranches'),
    hint: t('settings.advanced.showRemoteBranchesHint'),
    get: () => uiStore.showRemoteBranches,
    toggle: () => uiStore.toggleShowRemoteBranches(),
  },
  {
    key: 'showChangeStatsColumn',
    label: t('settings.advanced.showChangeStatsColumn'),
    hint: t('settings.advanced.showChangeStatsColumnHint'),
    get: () => uiStore.showChangeStatsColumn,
    toggle: () => uiStore.toggleShowChangeStatsColumn(),
  },
  {
    key: 'showUnreachable',
    label: t('settings.advanced.showUnreachable'),
    hint: t('settings.advanced.showUnreachableHint'),
    get: () => uiStore.showUnreachableCommits,
    toggle: () => uiStore.toggleShowUnreachable(),
  },
  {
    key: 'showStashes',
    label: t('settings.advanced.showStashes'),
    hint: t('settings.advanced.showStashesHint'),
    get: () => uiStore.showStashCommits,
    toggle: () => uiStore.toggleShowStashes(),
  },
  {
    key: 'debugLog',
    label: t('settings.advanced.debugLog'),
    hint: t('settings.advanced.debugLogHint'),
    get: () => uiStore.debugPanelVisible,
    toggle: () => uiStore.toggleDebugPanel(),
  },
  {
    key: 'detailFilesFirst',
    label: t('settings.advanced.detailFilesFirst'),
    hint: t('settings.advanced.detailFilesFirstHint'),
    get: () => uiStore.detailFilesFirst,
    toggle: () => uiStore.toggleDetailFilesFirst(),
  },
])

const viewPrefsAreDefault = computed(() =>
  uiStore.diffLayoutMode === DEFAULT_ADVANCED_VIEW_PREFS.diffLayoutMode
  && uiStore.diffGroupByHunk === DEFAULT_ADVANCED_VIEW_PREFS.diffGroupByHunk
  && uiStore.showRemoteBranches === DEFAULT_ADVANCED_VIEW_PREFS.showRemoteBranches
  && uiStore.showChangeStatsColumn === DEFAULT_ADVANCED_VIEW_PREFS.showChangeStatsColumn
  && uiStore.showUnreachableCommits === DEFAULT_ADVANCED_VIEW_PREFS.showUnreachableCommits
  && uiStore.showStashCommits === DEFAULT_ADVANCED_VIEW_PREFS.showStashCommits
  && uiStore.debugPanelVisible === DEFAULT_ADVANCED_VIEW_PREFS.debugPanelVisible
  && uiStore.detailFilesFirst === DEFAULT_ADVANCED_VIEW_PREFS.detailFilesFirst,
)

const fetchIntervalLabel = computed(() => {
  const opt = FETCH_INTERVAL_OPTIONS.find(
    (o) => o.value === gitPrefsStore.autoFetchInterval,
  )
  if (!opt) return String(gitPrefsStore.autoFetchInterval)
  return t(opt.labelKey, 'params' in opt ? opt.params : {})
})

async function onFetchIntervalChange(e: Event) {
  const secs = Number((e.target as HTMLSelectElement).value)
  gitPrefsStore.setAutoFetchInterval(secs)
  try {
    await git.setAutoFetchInterval(secs)
  } catch (err) {
    console.error('[gitPrefs] set_auto_fetch_interval failed', err)
  }
}
</script>

<template>
  <div class="section">
    <div class="section-title">
      <span>{{ t('settings.advanced.viewTitle') }}</span>
      <button
        type="button"
        class="reset-btn"
        :disabled="viewPrefsAreDefault"
        @click="uiStore.resetAdvancedViewPrefs()"
      >
        {{ t('settings.resetDefault') }}
      </button>
    </div>
    <div class="pref-row pref-row--top">
      <div class="pref-text">
        <div class="pref-label">{{ t('settings.advanced.diffLayout') }}</div>
        <div class="pref-hint">{{ t('settings.advanced.diffLayoutHint') }}</div>
      </div>
      <div class="segmented-control" role="radiogroup" :aria-label="t('settings.advanced.diffLayout')">
        <button
          v-for="opt in diffLayoutOptions"
          :key="opt.value"
          type="button"
          class="segmented-btn"
          :class="{ 'is-active': uiStore.diffLayoutMode === opt.value }"
          @click="uiStore.setDiffLayoutMode(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>
    <div class="toggle-list">
      <label
        v-for="row in viewToggles"
        :key="row.key"
        class="toggle-row"
      >
        <div class="toggle-text">
          <div class="toggle-label">{{ row.label }}</div>
          <div class="toggle-hint">{{ row.hint }}</div>
        </div>
        <input
          type="checkbox"
          class="toggle-checkbox"
          :checked="row.get()"
          @change="row.toggle()"
        />
      </label>
    </div>

    <!-- Git 操作偏好 -->
    <div class="section-title section-title--spaced">{{ t('settings.gitPrefs.title') }}</div>
    <div class="prefs-list">
      <!-- Auto-fetch 间隔 -->
      <div class="pref-row">
        <div class="pref-text">
          <div class="pref-label">{{ t('settings.gitPrefs.fetchIntervalLabel') }}</div>
          <div class="pref-hint">{{ t('settings.gitPrefs.fetchIntervalHint') }}</div>
        </div>
        <select
          class="pref-select"
          :value="gitPrefsStore.autoFetchInterval"
          @change="onFetchIntervalChange"
        >
          <option
            v-for="opt in FETCH_INTERVAL_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ t(opt.labelKey, 'params' in opt ? opt.params : {}) }}
          </option>
        </select>
      </div>
    </div>

  </div>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
  letter-spacing: 0.2px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-title--spaced {
  margin-top: 14px;
}

.reset-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-muted);
  font-family: inherit;
  font-size: var(--font-sm);
  font-weight: 400;
  padding: 2px 8px;
  cursor: pointer;
  transition: color 0.1s, border-color 0.1s, background 0.1s;
}

.reset-btn:hover:not(:disabled) {
  color: var(--accent-blue);
  border-color: var(--accent-blue);
  background: color-mix(in srgb, var(--accent-blue) 8%, transparent);
}

.reset-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.toggle-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid var(--border);
  border-radius: 5px;
  overflow: hidden;
  background: var(--border);
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  background: var(--bg-primary);
  cursor: pointer;
  transition: background 0.1s;
}

.toggle-row:hover {
  background: var(--bg-overlay);
}

.toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.toggle-label {
  font-size: var(--font-md);
  color: var(--text-primary);
}

.toggle-hint {
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.toggle-checkbox {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  accent-color: var(--accent-blue);
  cursor: pointer;
  margin: 0;
}

/* ── Git 偏好列表 ─────────────────────────────────────────────── */
.prefs-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid var(--border);
  border-radius: 5px;
  overflow: hidden;
  background: var(--border);
}

.pref-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  background: var(--bg-primary);
}

.pref-row--top {
  border: 1px solid var(--border);
  border-radius: 5px;
  margin-bottom: 1px;
}

.pref-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.pref-label {
  font-size: var(--font-md);
  color: var(--text-primary);
}

.pref-hint {
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.pref-select {
  flex-shrink: 0;
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 6px;
  font-size: var(--font-sm);
  cursor: pointer;
}

.pref-select:focus {
  outline: 1px solid var(--accent-blue);
}

.segmented-control {
  display: inline-flex;
  flex-shrink: 0;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-surface);
}

.segmented-btn {
  min-width: 64px;
  height: 24px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  cursor: pointer;
  padding: 0 8px;
}

.segmented-btn:hover {
  color: var(--text-primary);
  background: var(--bg-overlay);
}

.segmented-btn.is-active {
  color: var(--accent-blue);
  background: color-mix(in srgb, var(--accent-blue) 16%, transparent);
}

</style>
