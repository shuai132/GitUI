<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getVersion } from '@tauri-apps/api/app'

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
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="1.5">
        <circle cx="12" cy="12" r="4"/>
        <line x1="1.05" y1="12" x2="7" y2="12"/>
        <line x1="17.01" y1="12" x2="22.96" y2="12"/>
        <line x1="12" y1="1.05" x2="12" y2="7"/>
        <line x1="12" y1="17.01" x2="12" y2="22.96"/>
      </svg>
    </div>
    <div class="about-name">GitUI</div>
    <div class="about-fields">
      <div class="about-row">
        <span class="about-label">作者：</span>
        <span class="about-value">刘帅</span>
      </div>
      <div class="about-row">
        <span class="about-label">版本：</span>
        <span class="about-value">{{ appVersion }}</span>
      </div>
      <div class="about-row">
        <span class="about-label">项目：</span>
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

.about-label {
  color: var(--text-muted);
}

.about-value {
  color: var(--text-primary);
}

.about-link {
  color: var(--accent-blue);
  text-decoration: none;
  cursor: pointer;
}

.about-link:hover {
  text-decoration: underline;
}
</style>
