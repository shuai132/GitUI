<script setup lang="ts">
import { ref, watch, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import Modal from './Modal.vue'
import type { Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { useSettingsStore } from '@/stores/settings'

// Configure marked: open links in new tab (no XSS risk for known GitHub content)
marked.use({
  renderer: {
    link({ href, title, text }) {
      return `<a href="${href}" title="${title || ''}" target="_blank" rel="noopener noreferrer">${text}</a>`
    }
  }
})

const props = defineProps<{
  visible: boolean
  update: any // 绕过 Update 类型的 #private 检查
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

// Release notes from GitHub API
const releaseNotesHtml = ref<string | null>(null)
const notesLoading = ref(false)

async function fetchReleaseNotes(version: string) {
  notesLoading.value = true
  releaseNotesHtml.value = null
  try {
    const res = await fetch(
      `https://api.github.com/repos/shuai132/GitUI/releases/tags/v${version}`,
      { headers: { Accept: 'application/vnd.github+json' } }
    )
    if (res.ok) {
      const data = await res.json()
      const body: string = data.body || ''
      releaseNotesHtml.value = body ? (await marked.parse(body)) : null
    }
  } catch {
    // network failed — will fallback to update.body below
  } finally {
    notesLoading.value = false
  }
}

watch(
  () => props.update,
  (u) => { if (u) fetchReleaseNotes(u.version) },
  { immediate: true }
)

async function handleDownload() {
  if (!props.update || isDownloading.value) return
  
  isDownloading.value = true
  error.value = null
  downloadProgress.value = 0
  
  try {
    const update = toRaw(props.update) as Update
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        downloadProgress.value = 0
      } else if (event.event === 'Finished') {
        downloadProgress.value = 100
      }
      
      // 安全地处理进度信息，兼容不同版本的事件结构
      const anyEvent = event as any
      if (anyEvent.data && typeof anyEvent.data === 'object' && 'progress' in anyEvent.data) {
        downloadProgress.value = Math.round(anyEvent.data.progress * 100)
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
          <div v-if="notesLoading" class="release-notes-loading">
            <svg class="spinner" viewBox="0 0 24 24"><circle class="path" cx="12" cy="12" r="10" fill="none" stroke-width="3"></circle></svg>
          </div>
          <!-- Rendered markdown from GitHub API -->
          <div
            v-else-if="releaseNotesHtml"
            class="release-notes-body release-notes-md"
            v-html="releaseNotesHtml"
          />
          <!-- Fallback: plain text from latest.json -->
          <div v-else class="release-notes-body">
            {{ update.body || t('settings.about.noReleaseNotes') }}
          </div>
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
  max-height: 240px;
  overflow-y: auto;
  line-height: 1.6;
}

.release-notes-loading {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}

.release-notes-loading .spinner {
  animation: rotate 2s linear infinite;
  width: 18px;
  height: 18px;
}

.release-notes-loading .path {
  stroke: var(--accent-blue);
  stroke-linecap: round;
  animation: dash 1.5s ease-in-out infinite;
}

/* Markdown rendered styles */
.release-notes-md {
  white-space: normal;
}

.release-notes-md :deep(h1),
.release-notes-md :deep(h2),
.release-notes-md :deep(h3) {
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin: 8px 0 4px;
}

.release-notes-md :deep(p) {
  margin: 4px 0;
}

.release-notes-md :deep(ul),
.release-notes-md :deep(ol) {
  padding-left: 18px;
  margin: 4px 0;
}

.release-notes-md :deep(li) {
  margin: 2px 0;
}

.release-notes-md :deep(a) {
  color: var(--accent-blue);
  text-decoration: none;
}

.release-notes-md :deep(a:hover) {
  text-decoration: underline;
}

.release-notes-md :deep(code) {
  background: var(--bg-primary);
  border-radius: 3px;
  padding: 1px 4px;
  font-family: var(--code-font-family);
  font-size: 11px;
}

.release-notes-md :deep(pre) {
  background: var(--bg-primary);
  border-radius: 4px;
  padding: 8px;
  overflow-x: auto;
  margin: 6px 0;
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
