<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import type { UpdateStrategy } from '@/stores/settings'
import { useGitCommands } from '@/composables/useGitCommands'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { message } from '@tauri-apps/plugin-dialog'
import { formatTime } from '@/utils/format'
import {
  LAST_UPDATE_CHECK_EVENT,
  type UpdateChannel,
  isNetworkUpdateCheckError,
  readLastUpdateCheckTime,
  recordLastUpdateCheckTime,
  updateCheckErrorMessage,
} from '@/utils/updateCheck'
import { createDevelopmentUpdate } from '@/utils/developmentUpdate'
import UpdateDialog from '@/components/common/UpdateDialog.vue'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const git = useGitCommands()

const appVersion = ref('')
const gitHash = ref<string | null>(null)
const checkingChannel = ref<UpdateChannel | null>(null)
const lastCheckTime = ref<number | null>(null)
const availableUpdate = ref<Update | null>(null)
const dialogChannel = ref<UpdateChannel>('release')
const showUpdateDialog = ref(false)

const updateStrategyOptions = [
  { value: 'auto', labelKey: 'settings.advanced.updateStrategyAuto' },
  { value: 'manual', labelKey: 'settings.advanced.updateStrategyManual' },
] satisfies { value: UpdateStrategy; labelKey: string }[]

function refreshLastCheckTime() {
  lastCheckTime.value = readLastUpdateCheckTime()
}

onMounted(async () => {
  try {
    const info = await git.getBuildInfo()
    appVersion.value = info.version
    gitHash.value = info.git_hash
  } catch {}

  refreshLastCheckTime()
  window.addEventListener(LAST_UPDATE_CHECK_EVENT, refreshLastCheckTime)
})

onBeforeUnmount(() => {
  window.removeEventListener(LAST_UPDATE_CHECK_EVENT, refreshLastCheckTime)
})

const lastCheckLabel = computed(() => {
  if (!lastCheckTime.value) return t('settings.about.neverChecked')
  return t('settings.about.lastChecked', { time: formatTime(lastCheckTime.value) })
})

async function checkForUpdates(channel: UpdateChannel) {
  if (checkingChannel.value) return
  checkingChannel.value = channel
  try {
    const update = channel === 'release'
      ? await check()
      : createDevelopmentUpdate(await git.checkDevelopmentUpdate())
    if (channel === 'release') lastCheckTime.value = recordLastUpdateCheckTime()

    if (update) {
      availableUpdate.value = update
      dialogChannel.value = channel
      showUpdateDialog.value = true
    } else {
      await message(
        t(channel === 'release'
          ? 'settings.about.noUpdateFound'
          : 'settings.about.noDevelopmentUpdateFound'),
        {
          title: t(channel === 'release'
            ? 'settings.about.checkUpdate'
            : 'settings.about.checkDevelopmentUpdate'),
          kind: 'info',
        },
      )
    }
  } catch (err: unknown) {
    if (channel === 'release' && !isNetworkUpdateCheckError(err)) {
      lastCheckTime.value = recordLastUpdateCheckTime()
    }
    const detail = updateCheckErrorMessage(err)
    await message(`${t('settings.about.updateError')}：${detail}`, { title: '错误', kind: 'error' })
  } finally {
    checkingChannel.value = null
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
        <div class="check-actions">
          <button
            class="btn btn-secondary check-btn development-check-btn"
            :disabled="checkingChannel !== null"
            @click="checkForUpdates('development')"
          >
            <svg v-if="checkingChannel === 'development'" class="spinner" viewBox="0 0 24 24">
              <circle class="path" cx="12" cy="12" r="10" fill="none" stroke-width="3"></circle>
            </svg>
            {{ checkingChannel === 'development' ? t('settings.about.checking') : t('settings.about.checkDevelopmentUpdate') }}
          </button>
          <button
            class="btn btn-primary check-btn release-check-btn"
            :disabled="checkingChannel !== null"
            @click="checkForUpdates('release')"
          >
            <svg v-if="checkingChannel === 'release'" class="spinner" viewBox="0 0 24 24">
              <circle class="path" cx="12" cy="12" r="10" fill="none" stroke-width="3"></circle>
            </svg>
            {{ checkingChannel === 'release' ? t('settings.about.checking') : t('settings.about.checkUpdate') }}
          </button>
        </div>
      </div>
      <div class="version-footer">
        <div class="git-hash" v-if="gitHash">Build: {{ gitHash }}</div>
        <div class="last-check">{{ lastCheckLabel }}</div>
      </div>
      <div class="development-hint">{{ t('settings.about.developmentUpdateHint') }}</div>
      <label class="development-auto-setting">
        <div class="development-auto-text">
          <div class="development-auto-label">{{ t('settings.about.developmentAutoCheck') }}</div>
          <div class="development-auto-hint">{{ t('settings.about.developmentAutoCheckHint') }}</div>
        </div>
        <input
          type="checkbox"
          class="development-auto-checkbox"
          :checked="settingsStore.autoCheckDevelopmentUpdates"
          @change="settingsStore.autoCheckDevelopmentUpdates = !settingsStore.autoCheckDevelopmentUpdates"
        />
      </label>
    </div>

    <div class="strategy-list">
      <button
        v-for="opt in updateStrategyOptions" 
        :key="opt.value"
        type="button"
        class="strategy-item"
        :class="{ 'is-active': settingsStore.updateStrategy === opt.value }"
        :aria-pressed="settingsStore.updateStrategy === opt.value"
        @click="settingsStore.updateStrategy = opt.value"
      >
        <div class="strategy-radio">
          <div class="radio-inner"></div>
        </div>
        <div class="strategy-text">
          <div class="strategy-label">{{ t(opt.labelKey) }}</div>
          <div v-if="opt.value === 'auto'" class="strategy-hint">{{ t('settings.advanced.updateStrategyHint') }}</div>
        </div>
      </button>
    </div>

    <UpdateDialog 
      :visible="showUpdateDialog" 
      :update="availableUpdate" 
      :channel="dialogChannel"
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

.development-hint {
  font-size: var(--font-sm);
  color: var(--text-muted);
  line-height: 1.5;
}

.development-auto-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
  cursor: pointer;
}

.development-auto-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.development-auto-label {
  font-size: var(--font-md);
  color: var(--text-primary);
}

.development-auto-hint {
  font-size: var(--font-sm);
  color: var(--text-muted);
  line-height: 1.5;
}

.development-auto-checkbox {
  flex-shrink: 0;
  accent-color: var(--accent-blue);
}

.check-actions {
  display: flex;
  align-items: center;
  gap: 8px;
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
  width: 100%;
  gap: 12px;
  padding: 12px;
  border: 0;
  background: var(--bg-primary);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}

.strategy-item:hover {
  background: var(--bg-overlay);
}

.strategy-item:focus-visible {
  outline: 2px solid var(--accent-blue);
  outline-offset: -2px;
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

.btn-primary .spinner .path {
  stroke: #fff;
  stroke-linecap: round;
  animation: dash 1.5s ease-in-out infinite;
}

.btn-secondary .spinner .path {
  stroke: currentColor;
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
