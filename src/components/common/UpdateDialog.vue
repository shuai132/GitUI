<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from './Modal.vue'
import type { Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{
  visible: boolean
  update: Update | null
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()
const settings = useSettingsStore()
const isDownloading = ref(false)
const downloadProgress = ref(0)
const isDownloaded = ref(false)
const error = ref<string | null>(null)

async function handleDownload() {
  if (!props.update || isDownloading.value) return
  
  isDownloading.value = true
  error.value = null
  downloadProgress.value = 0
  
  try {
    await props.update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          downloadProgress.value = 0
          break
        case 'Progress':
          break
        case 'Finished':
          downloadProgress.value = 100
          break
      }
      
      // Some versions of the plugin use event.data for progress
      if (typeof event.data === 'object' && 'progress' in event.data) {
        // @ts-ignore
        downloadProgress.value = Math.round(event.data.progress * 100)
      } else if (event.event === 'Progress' && typeof event.data === 'number') {
        // Fallback or guess
      }
    })
    isDownloaded.value = true
    // If successfully downloaded, clear skipped version
    settings.skippedVersion = null
  } catch (err: any) {
    console.error('Download failed', err)
    error.value = err.message || String(err)
  } finally {
    isDownloading.value = false
  }
}

function handleSkip() {
  if (props.update) {
    settings.skippedVersion = props.update.version
  }
  handleClose()
}

function handleRestart() {
  void relaunch()
}

function handleClose() {
  if (isDownloading.value) return
  emit('close')
}
</script>

<template>
  <Modal :visible="visible" :title="t('settings.about.updateAvailable')" width="500px" @close="handleClose">
    <div class="update-dialog-content">
      <div v-if="update" class="update-info">
        <div class="version-badge">v{{ update.version }}</div>
        <div class="release-notes-container">
          <div class="release-notes-title">{{ t('settings.about.releaseNotes') }}</div>
          <div class="release-notes-body">{{ update.body || t('settings.about.noReleaseNotes') }}</div>
        </div>
      </div>

      <div v-if="isDownloading || isDownloaded || error" class="update-status">
        <div v-if="isDownloading" class="progress-section">
          <div class="progress-label">
            <span>{{ t('settings.about.downloading') }}</span>
            <span>{{ downloadProgress }}%</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" :style="{ width: `${downloadProgress}%` }"></div>
          </div>
        </div>

        <div v-if="isDownloaded" class="success-message">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="success-icon">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <span>{{ t('settings.about.updateDownloaded') }}</span>
        </div>

        <div v-if="error" class="error-message">
          {{ t('settings.about.updateError') }}: {{ error }}
        </div>
      </div>
    </div>

    <template #footer>
      <div class="footer-actions">
        <button v-if="!isDownloaded" class="btn btn-secondary btn-skip" :disabled="isDownloading" @click="handleSkip">
          {{ t('settings.about.skipVersion') }}
        </button>
        <div class="spacer"></div>
        <button v-if="!isDownloaded" class="btn btn-secondary" :disabled="isDownloading" @click="handleClose">
          {{ t('common.cancel') }}
        </button>
        <button v-if="!isDownloaded" class="btn btn-primary" :disabled="isDownloading" @click="handleDownload">
          {{ isDownloading ? t('settings.about.downloading') : t('settings.about.updateNow') }}
        </button>
        <button v-if="isDownloaded" class="btn btn-primary" @click="handleRestart">
          {{ t('settings.about.restartNow') }}
        </button>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.update-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.update-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.version-badge {
  align-self: flex-start;
  padding: 4px 10px;
  background: var(--accent-blue);
  color: #fff;
  border-radius: 12px;
  font-size: var(--font-sm);
  font-weight: 600;
}

.release-notes-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 12px;
  border: 1px solid var(--border);
}

.release-notes-title {
  font-weight: 600;
  font-size: var(--font-sm);
  color: var(--text-primary);
}

.release-notes-body {
  font-size: var(--font-sm);
  color: var(--text-muted);
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
  line-height: 1.5;
}

.update-status {
  margin-top: 4px;
}

.progress-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-label {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-sm);
  color: var(--text-primary);
}

.progress-bar-bg {
  height: 8px;
  background: var(--bg-secondary);
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border);
}

.progress-bar-fill {
  height: 100%;
  background: var(--accent-blue);
  transition: width 0.2s ease;
}

.success-message {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--accent-green);
  font-weight: 500;
  font-size: var(--font-sm);
}

.error-message {
  color: var(--accent-red);
  font-size: var(--font-sm);
  background: rgba(237, 135, 150, 0.1);
  padding: 8px 12px;
  border-radius: 4px;
  border-left: 3px solid var(--accent-red);
}

.footer-actions {
  display: flex;
  gap: 8px;
  width: 100%;
}

.spacer {
  flex: 1;
}

.btn-skip {
  opacity: 0.8;
}

.btn-skip:hover {
  opacity: 1;
}
</style>
