<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getVersion } from '@tauri-apps/api/app'

const { t } = useI18n()
const appVersion = ref('')

onMounted(async () => {
  try {
    appVersion.value = await getVersion()
  } catch {
    appVersion.value = ''
  }
})

async function openUrl(url: string) {
  const { openUrl: open } = await import('@tauri-apps/plugin-opener')
  open(url)
}
</script>

<template>
  <div class="about-content">
    <div class="about-icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 512 512">
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
    <div class="about-name">GitUI</div>
    <div class="about-fields">
      <div class="about-row">
        <span class="about-label">{{ t('settings.about.authorLabel') }}</span>
        <span class="about-value">{{ t('settings.about.authorValue') }}</span>
      </div>
      <div class="about-row">
        <span class="about-label">{{ t('settings.about.versionLabel') }}</span>
        <span class="about-value">{{ appVersion }}</span>
      </div>
      <div class="about-row about-row-project">
        <a
          class="about-link"
          href="https://github.com/shuai132/GitUI"
          target="_blank"
          rel="noopener"
          @click.prevent="openUrl('https://github.com/shuai132/GitUI')"
        >https://github.com/shuai132/GitUI</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.about-icon {
  margin-bottom: 4px;
}

.about-name {
  font-size: var(--font-xl);
  font-weight: 700;
  color: var(--text-primary);
}

.about-fields {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.about-row {
  display: flex;
  align-items: center;
  font-size: var(--font-md);
}

.about-row-project {
  margin-top: 2px;
}

.about-label {
  color: var(--text-muted);
}

.about-value {
  color: var(--text-primary);
}

.about-link {
  color: var(--text-muted);
  text-decoration: none;
  cursor: pointer;
  border-bottom: 1px dashed var(--text-muted);
  transition: color 0.15s, border-color 0.15s;
}

.about-link:hover {
  color: var(--text-primary);
  border-bottom-color: var(--text-primary);
}
</style>
