<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  useSettingsStore,
  UI_FONT_PRESETS,
  CODE_FONT_PRESETS,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
} from '@/stores/settings'

const store = useSettingsStore()
const { t } = useI18n()

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
      <select v-model="store.uiFontFamily" class="form-control">
        <option v-for="p in UI_FONT_PRESETS" :key="p.labelKey" :value="p.value">
          {{ t(p.labelKey) }}
        </option>
      </select>
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
      <select v-model="store.codeFontFamily" class="form-control">
        <option v-for="p in CODE_FONT_PRESETS" :key="p.labelKey" :value="p.value">
          {{ t(p.labelKey) }}
        </option>
      </select>
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

.hint {
  margin-top: 12px;
  font-size: var(--font-sm);
  color: var(--text-muted);
  line-height: 1.6;
}
</style>
