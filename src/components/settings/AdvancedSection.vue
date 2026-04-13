<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/stores/ui'
import { useSettingsStore } from '@/stores/settings'

const uiStore = useUiStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

interface ToggleRow {
  label: string
  hint: string
  get: () => boolean
  toggle: () => void
}

const viewToggles: ToggleRow[] = [
  {
    label: '显示悬垂引用',
    hint: '在历史图中绘制 HEAD reflog 中不可达的提交',
    get: () => uiStore.showUnreachableCommits,
    toggle: () => uiStore.toggleShowUnreachable(),
  },
  {
    label: '显示贮藏',
    hint: '在历史图中绘制 stash 节点',
    get: () => uiStore.showStashCommits,
    toggle: () => uiStore.toggleShowStashes(),
  },
  {
    label: '调试日志',
    hint: '在主界面底部展示调试日志面板',
    get: () => uiStore.debugPanelVisible,
    toggle: () => uiStore.toggleDebugPanel(),
  },
]

interface PlaceholderItem {
  label: string
  hint: string
}

const placeholders: PlaceholderItem[] = [
  { label: '快捷键', hint: '自定义键盘快捷键即将推出' },
  { label: 'Git 操作偏好', hint: '默认 pull 策略、自动 fetch 间隔即将推出' },
]
</script>

<template>
  <div class="section">
    <div class="section-title">视图</div>
    <div class="toggle-list">
      <label
        v-for="row in viewToggles"
        :key="row.label"
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

    <div class="section-title section-title--spaced">{{ t('settings.advanced.uiLanguageTitle') }}</div>
    <div class="lang-row">
      <select v-model="settingsStore.uiLanguage" class="lang-select">
        <option value="auto">{{ t('settings.advanced.uiLanguageAuto') }}</option>
        <option value="zh-CN">中文</option>
        <option value="en">English</option>
      </select>
      <span class="lang-hint">{{ t('settings.advanced.uiLanguageHint') }}</span>
    </div>

    <div class="section-title section-title--spaced">即将推出</div>
    <div class="placeholder-list">
      <div v-for="item in placeholders" :key="item.label" class="placeholder-row">
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

.lang-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 5px;
}

.lang-select {
  appearance: none;
  background: var(--bg-overlay);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 10px;
  font-size: var(--font-md);
  cursor: pointer;
}

.lang-select:focus {
  outline: none;
  border-color: var(--accent-blue);
}

.lang-hint {
  font-size: var(--font-sm);
  color: var(--text-muted);
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
