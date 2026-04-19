<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore, MIN_FONT_SIZE, MAX_FONT_SIZE } from '@/stores/settings'
import { useGitCommands } from '@/composables/useGitCommands'

const store = useSettingsStore()
const { t } = useI18n()
const { listSystemFonts } = useGitCommands()

const systemFonts = ref<string[]>([])

onMounted(async () => {
  const fonts = await listSystemFonts().catch(() => [])
  systemFonts.value = fonts
})

function clampSize(n: number): number {
  if (!Number.isFinite(n)) return 13
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(n)))
}

function onUiSize(e: Event) {
  store.uiFontSize = clampSize(Number((e.target as HTMLInputElement).value))
}

function onCodeSize(e: Event) {
  store.codeFontSize = clampSize(Number((e.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="section">
    <div class="section-title">
      <span>{{ t('settings.font.uiTitle') }}</span>
      <button
        class="reset-btn"
        :disabled="store.uiFontIsDefault"
        :title="t('settings.font.resetUi')"
        @click="store.resetUiFont()"
      >
        {{ t('settings.font.resetDefault') }}
      </button>
    </div>
    <div class="form-row">
      <label class="form-label">{{ t('settings.font.familyLabel') }}</label>
      <input
        v-model="store.uiFontFamily"
        type="text"
        list="font-ui-list"
        class="form-control"
        :placeholder="t('settings.font.defaultPlaceholder')"
        autocomplete="off"
        spellcheck="false"
      />
      <datalist id="font-ui-list">
        <option v-for="f in systemFonts" :key="f" :value="f" />
      </datalist>
    </div>
    <div class="form-row">
      <label class="form-label">{{ t('settings.font.sizeLabel') }}</label>
      <div class="size-group">
        <input
          type="number"
          class="form-control size-input"
          :min="MIN_FONT_SIZE"
          :max="MAX_FONT_SIZE"
          :value="store.uiFontSize"
          @input="onUiSize"
        />
        <span class="size-unit">px</span>
      </div>
    </div>
    <div class="preview-row">
      <span class="preview-label">{{ t('settings.font.preview') }}</span>
      <span class="preview-ui">GitUI — The quick brown fox · 仓库切换 0123</span>
    </div>

    <div class="section-title section-title--spaced">
      <span>{{ t('settings.font.codeTitle') }}</span>
      <button
        class="reset-btn"
        :disabled="store.codeFontIsDefault"
        :title="t('settings.font.resetCode')"
        @click="store.resetCodeFont()"
      >
        {{ t('settings.font.resetDefault') }}
      </button>
    </div>
    <div class="form-row">
      <label class="form-label">{{ t('settings.font.familyLabel') }}</label>
      <input
        v-model="store.codeFontFamily"
        type="text"
        list="font-code-list"
        class="form-control"
        :placeholder="t('settings.font.defaultPlaceholder')"
        autocomplete="off"
        spellcheck="false"
      />
      <datalist id="font-code-list">
        <option v-for="f in systemFonts" :key="f" :value="f" />
      </datalist>
    </div>
    <div class="form-row">
      <label class="form-label">{{ t('settings.font.sizeLabel') }}</label>
      <div class="size-group">
        <input
          type="number"
          class="form-control size-input"
          :min="MIN_FONT_SIZE"
          :max="MAX_FONT_SIZE"
          :value="store.codeFontSize"
          @input="onCodeSize"
        />
        <span class="size-unit">px</span>
      </div>
    </div>
    <div class="preview-row">
      <span class="preview-label">{{ t('settings.font.preview') }}</span>
      <span class="preview-code">def main() → None:  # abc1f2e3  +42 -7</span>
    </div>

    <div class="hint">
      {{ t('settings.font.hint') }}
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-title--spaced {
  margin-top: 14px;
}

.reset-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-muted);
  font-family: inherit;
  font-size: var(--font-sm);
  font-weight: 400;
  padding: 2px 8px;
  cursor: pointer;
  transition: color 0.1s, border-color 0.1s, background 0.1s;
}

.reset-btn:hover:not(:disabled) {
  color: var(--accent-blue);
  border-color: var(--accent-blue);
  background: color-mix(in srgb, var(--accent-blue) 8%, transparent);
}

.reset-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.form-row {
  display: grid;
  grid-template-columns: 80px 1fr;
  align-items: center;
  gap: 10px;
}

.form-label {
  font-size: var(--font-md);
  color: var(--text-secondary);
  text-align: right;
}

.form-control {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-md);
  padding: 5px 8px;
  outline: none;
  width: 100%;
}

.form-control:focus {
  border-color: var(--accent-blue);
}

.size-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.size-input {
  width: 80px;
}

.size-unit {
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.preview-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-top: 2px;
}

.preview-label {
  font-size: var(--font-xs);
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.preview-ui {
  font-family: var(--ui-font-family);
  font-size: var(--ui-font-size);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-code {
  font-family: var(--code-font-family);
  font-size: var(--code-font-size);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hint {
  margin-top: 12px;
  font-size: var(--font-sm);
  color: var(--text-muted);
  line-height: 1.6;
}
</style>
