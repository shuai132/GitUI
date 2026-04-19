<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/stores/ui'
import { useGitPrefsStore, FETCH_INTERVAL_OPTIONS } from '@/stores/gitPrefs'
import { useGitCommands } from '@/composables/useGitCommands'

const uiStore = useUiStore()
const gitPrefsStore = useGitPrefsStore()
const git = useGitCommands()
const { t } = useI18n()

interface ToggleRow {
  key: string
  label: string
  hint: string
  get: () => boolean
  toggle: () => void
}

const viewToggles = computed<ToggleRow[]>(() => [
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
    <div class="section-title">{{ t('settings.advanced.viewTitle') }}</div>
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

    <!-- 快捷键（占位保留） -->
    <div class="section-title section-title--spaced">{{ t('settings.advanced.upcomingTitle') }}</div>
    <div class="placeholder-list">
      <div class="placeholder-row">
        <div class="placeholder-label">{{ t('settings.advanced.shortcuts') }}</div>
        <div class="placeholder-hint">{{ t('settings.advanced.shortcutsHint') }}</div>
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
}

.section-title--spaced {
  margin-top: 14px;
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

/* ── 占位列表（快捷键等待实现） ──────────────────────────────── */
.placeholder-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid var(--border);
  border-radius: 5px;
  overflow: hidden;
  background: var(--border);
}

.placeholder-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg-primary);
  opacity: 0.55;
}

.placeholder-label {
  font-size: var(--font-md);
  color: var(--text-primary);
}

.placeholder-hint {
  font-size: var(--font-sm);
  color: var(--text-muted);
}
</style>
