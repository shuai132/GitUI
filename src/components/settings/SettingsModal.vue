<script setup lang="ts">
import { ref, computed } from 'vue'
import Modal from '@/components/common/Modal.vue'
import AppearanceSection from './AppearanceSection.vue'
import FontSection from './FontSection.vue'
import ExternalToolsSection from './ExternalToolsSection.vue'
import AdvancedSection from './AdvancedSection.vue'
import AboutInfo from '@/components/common/AboutInfo.vue'
import { useSettingsStore } from '@/stores/settings'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useSettingsStore()

type Tab = 'appearance' | 'font' | 'tools' | 'advanced' | 'about'
const activeTab = ref<Tab>('appearance')

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'appearance', label: '外观' },
  { id: 'font', label: '字体' },
  { id: 'tools', label: '外部工具' },
  { id: 'advanced', label: '高级' },
  { id: 'about', label: '关于' },
]

const resetLabel = computed(() => {
  switch (activeTab.value) {
    case 'appearance': return '恢复外观默认'
    case 'font': return '恢复字体默认'
    case 'tools': return '恢复外部工具默认'
    default: return '恢复默认'
  }
})

function onReset() {
  if (activeTab.value === 'appearance') store.resetAppearance()
  else if (activeTab.value === 'font') store.resetFont()
  else if (activeTab.value === 'tools') store.resetExternalTools()
}

const resetDisabled = computed(() =>
  activeTab.value === 'advanced' || activeTab.value === 'about',
)
</script>

<template>
  <Modal :visible="visible" title="设置" width="720px" @close="emit('close')">
    <div class="settings-layout">
      <nav class="settings-tabs">
        <button
          v-for="t in tabs"
          :key="t.id"
          class="tab-btn"
          :class="{ 'is-active': activeTab === t.id }"
          @click="activeTab = t.id"
        >
          {{ t.label }}
        </button>
      </nav>
      <div class="settings-content">
        <AppearanceSection v-if="activeTab === 'appearance'" />
        <FontSection v-else-if="activeTab === 'font'" />
        <ExternalToolsSection v-else-if="activeTab === 'tools'" />
        <AdvancedSection v-else-if="activeTab === 'advanced'" />
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
      <button class="btn btn-primary" @click="emit('close')">完成</button>
    </template>
  </Modal>
</template>

<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 16px;
  min-height: 380px;
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

.btn {
  padding: 6px 18px;
  border-radius: 5px;
  font-family: inherit;
  font-size: var(--font-md);
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.btn-secondary {
  background: var(--bg-overlay);
  color: var(--text-primary);
  border-color: var(--border);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-primary);
}

.btn-primary {
  background: var(--accent-blue);
  color: var(--bg-primary);
  font-weight: 600;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn-footer-left {
  margin-right: auto;
}
</style>
