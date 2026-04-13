<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/stores/ui'

const uiStore = useUiStore()
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
])

interface PlaceholderItem {
  key: string
  label: string
  hint: string
}

const placeholders = computed<PlaceholderItem[]>(() => [
  { key: 'shortcuts', label: t('settings.advanced.shortcuts'), hint: t('settings.advanced.shortcutsHint') },
  { key: 'gitPrefs', label: t('settings.advanced.gitPrefs'), hint: t('settings.advanced.gitPrefsHint') },
])
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

    <div class="section-title section-title--spaced">{{ t('settings.advanced.upcomingTitle') }}</div>
    <div class="placeholder-list">
      <div v-for="item in placeholders" :key="item.key" class="placeholder-row">
        <div class="placeholder-label">{{ item.label }}</div>
        <div class="placeholder-hint">{{ item.hint }}</div>
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
