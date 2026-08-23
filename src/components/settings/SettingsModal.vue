<script setup lang="ts">
import { ref, computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'
import AppearanceSection from './AppearanceSection.vue'
import FontSection from './FontSection.vue'
import ExternalToolsSection from './ExternalToolsSection.vue'
import AdvancedSection from './AdvancedSection.vue'
import ShortcutsSection from './ShortcutsSection.vue'
import UpdateSection from './UpdateSection.vue'
import PluginsSection from './PluginsSection.vue'
import AboutInfo from '@/components/common/AboutInfo.vue'
import { useSettingsStore } from '@/stores/settings'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useSettingsStore()
const { t } = useI18n()

type Tab = 'appearance' | 'font' | 'tools' | 'advanced' | 'shortcuts' | 'plugins' | 'update' | 'about'
const activeTab = ref<Tab>('appearance')
const tabsetId = useId()
const panelId = `settings-panel-${tabsetId}`

function tabId(tab: Tab): string {
  return `settings-tab-${tabsetId}-${tab}`
}

const tabs = computed<Array<{ id: Tab; label: string }>>(() => [
  { id: 'appearance', label: t('settings.tabs.appearance') },
  { id: 'font', label: t('settings.tabs.font') },
  { id: 'tools', label: t('settings.tabs.externalTools') },
  { id: 'advanced', label: t('settings.tabs.advanced') },
  { id: 'shortcuts', label: t('settings.tabs.shortcuts') },
  { id: 'plugins', label: t('settings.tabs.plugins') },
  { id: 'update', label: t('settings.tabs.update') },
  { id: 'about', label: t('settings.tabs.about') },
])

function onTabKeydown(e: KeyboardEvent, currentTab: Tab) {
  const tabOrder = tabs.value.map((tab) => tab.id)
  const currentIndex = tabOrder.indexOf(currentTab)
  let nextIndex: number | null = null
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % tabOrder.length
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + tabOrder.length) % tabOrder.length
  }
  if (e.key === 'Home') nextIndex = 0
  if (e.key === 'End') nextIndex = tabOrder.length - 1
  if (nextIndex === null) return

  e.preventDefault()
  const nextTab = tabOrder[nextIndex]
  activeTab.value = nextTab
  const tabList = (e.currentTarget as HTMLElement).closest('[role="tablist"]')
  tabList?.querySelector<HTMLElement>(`[data-settings-tab="${nextTab}"]`)?.focus()
}

const resetLabel = computed(() => {
  switch (activeTab.value) {
    case 'appearance': return t('settings.resetAppearance')
    case 'font': return t('settings.resetFont')
    case 'tools': return t('settings.resetExternalTools')
    default: return t('settings.resetDefault')
  }
})

function onReset() {
  if (activeTab.value === 'appearance') store.resetAppearance()
  else if (activeTab.value === 'font') store.resetFont()
  else if (activeTab.value === 'tools') store.resetExternalTools()
}

const resetDisabled = computed(() =>
  activeTab.value === 'advanced'
  || activeTab.value === 'shortcuts'
  || activeTab.value === 'plugins'
  || activeTab.value === 'update'
  || activeTab.value === 'about',
)
</script>

<template>
  <Modal
    :visible="visible"
    :title="t('settings.title')"
    width="720px"
    height="90vh"
    body-class="modal-body--contained-scroll"
    @close="emit('close')"
  >
    <div class="settings-layout">
      <nav class="settings-tabs" role="tablist" aria-orientation="vertical">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="tab-btn"
          :class="{ 'is-active': activeTab === tab.id }"
          role="tab"
          :id="tabId(tab.id)"
          :data-settings-tab="tab.id"
          :aria-selected="activeTab === tab.id"
          :aria-controls="panelId"
          :tabindex="activeTab === tab.id ? 0 : -1"
          @click="activeTab = tab.id"
          @keydown="onTabKeydown($event, tab.id)"
        >
          {{ tab.label }}
        </button>
      </nav>
      <div
        :id="panelId"
        class="settings-content"
        role="tabpanel"
        :aria-labelledby="tabId(activeTab)"
        tabindex="0"
      >
        <AppearanceSection v-if="activeTab === 'appearance'" />
        <FontSection v-else-if="activeTab === 'font'" />
        <ExternalToolsSection v-else-if="activeTab === 'tools'" />
        <AdvancedSection v-else-if="activeTab === 'advanced'" />
        <ShortcutsSection v-else-if="activeTab === 'shortcuts'" />
        <PluginsSection v-else-if="activeTab === 'plugins'" />
        <UpdateSection v-else-if="activeTab === 'update'" />
        <div v-else class="about-wrap">
          <AboutInfo />
        </div>
      </div>
    </div>

    <template #footer>
      <button
        class="btn btn-secondary btn-footer-left"
        :disabled="resetDisabled"
        @click="onReset"
      >
        {{ resetLabel }}
      </button>
      <button class="btn btn-primary" @click="emit('close')">{{ t('settings.done') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 16px;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.settings-tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-right: 1px solid var(--border);
  padding-right: 10px;
}

.tab-btn {
  text-align: left;
  padding: 7px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--font-md);
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.tab-btn:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.tab-btn.is-active {
  background: color-mix(in srgb, var(--accent-blue) 15%, transparent);
  color: var(--accent-blue);
  font-weight: 600;
}

.settings-content {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}

/* 关于 tab 把内容竖直居中，整体观感与 AppToolbar 里的"关于"Modal 一致 */
.about-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 340px;
  padding: 20px 0;
}

.btn-footer-left {
  margin-right: auto;
}
</style>
