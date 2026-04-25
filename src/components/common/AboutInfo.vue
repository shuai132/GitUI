<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGitCommands } from '@/composables/useGitCommands'
import { formatTime } from '@/utils/format'

const { t } = useI18n()
const git = useGitCommands()
const appVersion = ref('')
const gitHash = ref<string | null>(null)

const versionLabel = computed(() => {
  if (!appVersion.value) return ''
  return gitHash.value ? `v${appVersion.value} (${gitHash.value})` : `v${appVersion.value}`
})

onMounted(async () => {
  try {
    const info = await git.getBuildInfo()
    appVersion.value = info.version
    gitHash.value = info.git_hash
  } catch {
    appVersion.value = ''
    gitHash.value = null
  }
})

async function openUrl(url: string) {
  const { openUrl: open } = await import('@tauri-apps/plugin-opener')
  open(url)
}
</script>

<template>
  <div class="about-content">
    <div class="about-header">
      <div class="about-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 512 512">
          <rect width="512" height="512" rx="112" fill="#1e2030"/>
          <line x1="186" y1="110" x2="186" y2="402" stroke="#494d64" stroke-width="6" stroke-linecap="round"/>
          <path d="M 186 210 C 186 300, 326 260, 326 350" stroke="#494d64" stroke-width="6" fill="none" stroke-linecap="round"/>
          <path d="M 326 350 C 326 390, 186 375, 186 402" stroke="#494d64" stroke-width="6" fill="none" stroke-linecap="round"/>
          <circle cx="186" cy="402" r="26" fill="#1e2030" stroke="#f5a97f" stroke-width="5"/>
          <circle cx="186" cy="402" r="13" fill="#f5a97f"/>
          <circle cx="186" cy="210" r="20" fill="#1e2030" stroke="#8aadf4" stroke-width="5"/>
          <circle cx="186" cy="210" r="10" fill="#8aadf4"/>
          <circle cx="326" cy="350" r="22" fill="#1e2030" stroke="#a6da95" stroke-width="5"/>
          <circle cx="326" cy="350" r="11" fill="#a6da95"/>
          <circle cx="186" cy="110" r="30" fill="#1e2030" stroke="#c6a0f6" stroke-width="6"/>
          <circle cx="186" cy="110" r="15" fill="#c6a0f6"/>
          <circle cx="186" cy="110" r="40" fill="none" stroke="#c6a0f6" stroke-width="2" opacity="0.25"/>
        </svg>
      </div>
      <div class="about-title-info">
        <div class="about-name">GitUI</div>
        <div class="about-version">{{ versionLabel }}</div>
      </div>
    </div>

    <div class="about-body">
      <div class="about-info-grid">
        <div class="info-row">
          <span class="info-label">{{ t('settings.about.authorLabel') }}</span>
          <span class="info-value">{{ t('settings.about.authorValue') }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">{{ t('settings.about.githubLabel') }}</span>
          <a
            class="about-link"
            href="https://github.com/shuai132/GitUI"
            target="_blank"
            rel="noopener"
            @click.prevent="openUrl('https://github.com/shuai132/GitUI')"
          >https://github.com/shuai132/GitUI</a>
        </div>
      </div>
      <div class="about-copyright">
        {{ t('settings.about.copyright') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 盖过全局 * { user-select: none }：需要连子孙一起覆写 */
.about-content,
.about-content * {
  user-select: text;
  -webkit-user-select: text;
}

.about-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 20px;
  text-align: center;
}

.about-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.about-icon {
  flex-shrink: 0;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
}

.about-title-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.about-name {
  font-size: 28px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.5px;
}

.about-version {
  font-size: var(--font-md);
  color: var(--text-muted);
  font-family: var(--code-font-family);
}

.about-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
}

.about-info-grid {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: var(--font-md);
}

.info-label {
  color: var(--text-muted);
}

.info-value {
  color: var(--text-primary);
  font-weight: 500;
}

.about-link {
  color: var(--accent-blue);
  text-decoration: none;
  cursor: pointer;
  transition: opacity 0.15s;
}

.about-link:hover {
  opacity: 0.8;
  text-decoration: underline;
}

.about-copyright {
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.8;
}
</style>

