<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { useGitCommands } from '@/composables/useGitCommands'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { message } from '@tauri-apps/plugin-dialog'
import { formatTime } from '@/utils/format'
import UpdateDialog from '@/components/common/UpdateDialog.vue'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const git = useGitCommands()

const appVersion = ref('')
const gitHash = ref<string | null>(null)
const isChecking = ref(false)
const lastCheckTime = ref<number | null>(null)
const availableUpdate = ref<Update | null>(null)
const showUpdateDialog = ref(false)

const LAST_CHECK_KEY = 'gitui.last_update_check'

const updateStrategyOptions = [
  { value: 'auto', labelKey: 'settings.advanced.updateStrategyAuto' },
  { value: 'manual', labelKey: 'settings.advanced.updateStrategyManual' },
]

onMounted(async () => {
  try {
    const info = await git.getBuildInfo()
    appVersion.value = info.version
    gitHash.value = info.git_hash
  } catch {}

  const saved = localStorage.getItem(LAST_CHECK_KEY)
  if (saved) {
    lastCheckTime.value = parseInt(saved, 10)
  }
})

const lastCheckLabel = computed(() => {
  if (!lastCheckTime.value) return t('settings.about.neverChecked')
  return t('settings.about.lastChecked', { time: formatTime(lastCheckTime.value) })
})

async function checkForUpdates() {
  if (isChecking.value) return
  isChecking.value = true
  try {
    const update = await check()
    lastCheckTime.value = Math.floor(Date.now() / 1000)
    localStorage.setItem(LAST_CHECK_KEY, lastCheckTime.value.toString())

    if (update) {
      availableUpdate.value = update
      showUpdateDialog.value = true
    } else {
      await message(t('settings.about.noUpdateFound'), { title: t('settings.about.checkUpdate'), kind: 'info' })
    }
  } catch (err: any) {
    await message(`${t('settings.about.updateError')}：${err.message || err}`, { title: '错误', kind: 'error' })
  } finally {
    isChecking.value = false
  }
}
</script>

<template>
  <div class="update-section">
    <div class="section-title">{{ t('settings.advanced.updateStrategyTitle') }}</div>
    
    <div class="current-version-card">
      <div class="version-main">
        <div class="app-info">
          <span class="app-name">GitUI</span>
          <span class="app-ver">v{{ appVersion }}</span>
        </div>
        <button 
          class="btn btn-primary check-btn" 
          :disabled="isChecking"
          @click="checkForUpdates"
        >
          <svg v-if="isChecking" class="spinner" viewBox="0 0 24 24">
            <circle class="path" cx="12" cy="12" r="10" fill="none" stroke-width="3"></circle>
          </svg>
          {{ isChecking ? t('settings.about.checking') : t('settings.about.checkUpdate') }}
        </button>
      </div>
      <div class="version-footer">
        <div class="git-hash" v-if="gitHash">Build: {{ gitHash }}</div>
        <div class="last-check">{{ lastCheckLabel }}</div>
      </div>
    </div>

    <div class="strategy-list">
      <div 
        v-for="opt in updateStrategyOptions" 
        :key="opt.value"
        class="strategy-item"
        :class="{ 'is-active': settingsStore.updateStrategy === opt.value }"
        @click="settingsStore.updateStrategy = opt.value as any"
      >
        <div class="strategy-radio">
          <div class="radio-inner"></div>
        </div>
        <div class="strategy-text">
          <div class="strategy-label">{{ t(opt.labelKey) }}</div>
          <div v-if="opt.value === 'auto'" class="strategy-hint">{{ t('settings.advanced.updateStrategyHint') }}</div>
        </div>
      </div>
    </div>

    <UpdateDialog 
      :visible="showUpdateDialog" 
      :update="availableUpdate" 
      @close="showUpdateDialog = false" 
    />
  </div>
</template>

<style scoped>
.update-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-title {
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--text-secondary);
}

.current-version-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.version-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.app-info {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.app-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.app-ver {
  font-size: var(--font-md);
  color: var(--text-muted);
  font-family: var(--code-font-family);
}

.version-footer {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
  border-top: 1px solid var(--border);
  padding-top: 10px;
}

.strategy-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.strategy-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: var(--bg-primary);
  cursor: pointer;
  transition: background 0.1s;
}

.strategy-item:hover {
  background: var(--bg-overlay);
}

.strategy-item.is-active {
  background: color-mix(in srgb, var(--accent-blue) 5%, var(--bg-primary));
}

.strategy-radio {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid var(--text-muted);
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.is-active .strategy-radio {
  border-color: var(--accent-blue);
  background: var(--accent-blue);
}

.radio-inner {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  transform: scale(0);
  transition: transform 0.1s;
}

.is-active .radio-inner {
  transform: scale(1);
}

.strategy-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.strategy-label {
  font-size: var(--font-md);
  color: var(--text-primary);
}

.strategy-hint {
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.check-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
}

.spinner {
  animation: rotate 2s linear infinite;
  width: 14px;
  height: 14px;
}

.spinner .path {
  stroke: #fff;
  stroke-linecap: round;
  animation: dash 1.5s ease-in-out infinite;
}

@keyframes rotate {
  100% { transform: rotate(360deg); }
}

@keyframes dash {
  0% { stroke-dasharray: 1, 150; stroke-dashoffset: 0; }
  50% { stroke-dasharray: 90, 150; stroke-dashoffset: -35; }
  100% { stroke-dasharray: 90, 150; stroke-dashoffset: -124; }
}
</style>
