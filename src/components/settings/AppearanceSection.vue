<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  DEFAULT_SETTINGS,
  HISTORY_ROW_HEIGHT_MAX,
  HISTORY_ROW_HEIGHT_MIN,
  ROW_SEPARATOR_MAX,
  clampHistoryRowHeight,
  clampSeparatorStrength,
  useSettingsStore,
  type AccentKey,
  type GraphStyle,
  type RowSeparatorStyle,
  type ThemeMode,
  type UiLanguage,
} from '@/stores/settings'

const store = useSettingsStore()
const { t } = useI18n()

const themeOptions = computed<Array<{ value: ThemeMode; label: string }>>(() => [
  { value: 'auto', label: t('settings.appearance.themeAuto') },
  { value: 'light', label: t('settings.appearance.themeLight') },
  { value: 'dark', label: t('settings.appearance.themeDark') },
])

// 语言卡片：`auto` 走 i18n 跟随当前 locale，`zh-CN` / `en` 用原生名固定
const languageOptions = computed<Array<{ value: UiLanguage; label: string }>>(() => [
  { value: 'auto', label: t('settings.advanced.uiLanguageAuto') },
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' },
])

const graphStyleOptions = computed<Array<{ value: GraphStyle; label: string }>>(() => [
  { value: 'rounded', label: t('settings.appearance.graphRounded') },
  { value: 'step', label: t('settings.appearance.graphStep') },
  { value: 'angular', label: t('settings.appearance.graphAngular') },
])

const separatorStyleOptions = computed<Array<{ value: RowSeparatorStyle; label: string }>>(() => [
  { value: 'solid', label: t('settings.appearance.separatorStyleSolid') },
  { value: 'dashed', label: t('settings.appearance.separatorStyleDashed') },
  { value: 'dotted', label: t('settings.appearance.separatorStyleDotted') },
])

function onSeparatorStrengthInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  store.rowSeparatorStrength = clampSeparatorStrength(v)
}

const separatorOpacityText = computed(() => {
  const s = store.rowSeparatorStrength
  return s === 0 ? t('settings.appearance.separatorOpacityNone') : `${s}%`
})

const separatorFillPercent = computed(
  () => `${(store.rowSeparatorStrength / ROW_SEPARATOR_MAX) * 100}%`,
)

const separatorStrengthIsDefault = computed(
  () => store.rowSeparatorStrength === DEFAULT_SETTINGS.rowSeparatorStrength,
)

function resetSeparatorStrength() {
  store.rowSeparatorStrength = DEFAULT_SETTINGS.rowSeparatorStrength
}

function onHistoryRowHeightInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  store.historyRowHeight = clampHistoryRowHeight(v)
}

const historyRowHeightFillPercent = computed(() => {
  const range = HISTORY_ROW_HEIGHT_MAX - HISTORY_ROW_HEIGHT_MIN
  const offset = store.historyRowHeight - HISTORY_ROW_HEIGHT_MIN
  return `${(offset / range) * 100}%`
})

const historyRowHeightIsDefault = computed(
  () => store.historyRowHeight === DEFAULT_SETTINGS.historyRowHeight,
)

function resetHistoryRowHeight() {
  store.historyRowHeight = DEFAULT_SETTINGS.historyRowHeight
}

interface AccentRow {
  key: AccentKey
  label: string
  /** 当前默认值（未覆盖时页面使用的值），仅用于颜色拾取器的初始值 */
}

const accentRows = computed<AccentRow[]>(() => [
  { key: 'blue', label: t('settings.appearance.accentLabel.blue') },
  { key: 'green', label: t('settings.appearance.accentLabel.green') },
  { key: 'red', label: t('settings.appearance.accentLabel.red') },
  { key: 'yellow', label: t('settings.appearance.accentLabel.yellow') },
  { key: 'orange', label: t('settings.appearance.accentLabel.orange') },
])

function overrideValue(key: AccentKey): string {
  return store.accentOverrides[key] ?? ''
}

function resolvedColor(key: AccentKey): string {
  // 读取 :root 上当前的计算值，用于颜色拾取器展示"当前实际颜色"
  if (typeof window === 'undefined') return '#000000'
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--accent-${key}`).trim()
  return v || '#000000'
}

function onColorInput(key: AccentKey, e: Event) {
  const hex = (e.target as HTMLInputElement).value
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    store.setAccentOverride(key, hex.toLowerCase())
  }
}

function onHexTextInput(key: AccentKey, e: Event) {
  const raw = (e.target as HTMLInputElement).value.trim()
  if (!raw) {
    store.setAccentOverride(key, undefined)
    return
  }
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
    store.setAccentOverride(key, raw.toLowerCase())
  }
  // 格式错误时不写入，等用户继续输入
}

function onHexBlur(key: AccentKey, e: Event) {
  // 失焦时如果文本不是合法 hex，恢复为覆盖值（或清空）
  const raw = (e.target as HTMLInputElement).value.trim()
  if (raw && !/^#[0-9a-fA-F]{6}$/.test(raw)) {
    ;(e.target as HTMLInputElement).value = overrideValue(key)
  }
}

function clearOverride(key: AccentKey) {
  store.setAccentOverride(key, undefined)
}

const hasAnyOverride = computed(() => Object.keys(store.accentOverrides).length > 0)
</script>

<template>
  <div class="section">
    <div class="section-title">{{ t('settings.advanced.uiLanguageTitle') }}</div>
    <div class="theme-grid">
      <label
        v-for="opt in languageOptions"
        :key="opt.value"
        class="theme-card"
        :class="{ 'is-active': store.uiLanguage === opt.value }"
      >
        <input
          type="radio"
          name="ui-language"
          :value="opt.value"
          :checked="store.uiLanguage === opt.value"
          @change="store.uiLanguage = opt.value"
        />
        <span class="theme-card-label">{{ opt.label }}</span>
      </label>
    </div>

    <div class="section-title section-title--spaced">{{ t('settings.appearance.themeTitle') }}</div>
    <div class="theme-grid">
      <label
        v-for="opt in themeOptions"
        :key="opt.value"
        class="theme-card"
        :class="{ 'is-active': store.themeMode === opt.value }"
      >
        <input
          type="radio"
          name="theme-mode"
          :value="opt.value"
          :checked="store.themeMode === opt.value"
          @change="store.themeMode = opt.value"
        />
        <span class="theme-card-label">{{ opt.label }}</span>
      </label>
    </div>

    <div class="section-title section-title--spaced">
      {{ t('settings.appearance.accentTitle') }}
      <span class="section-title-hint">{{ t('settings.appearance.accentHint') }}</span>
    </div>
    <div class="accent-list">
      <div v-for="row in accentRows" :key="row.key" class="accent-row">
        <div class="accent-label">{{ row.label }}</div>
        <input
          type="color"
          class="accent-color"
          :value="overrideValue(row.key) || resolvedColor(row.key)"
          @input="onColorInput(row.key, $event)"
        />
        <input
          type="text"
          class="accent-hex"
          spellcheck="false"
          autocomplete="off"
          placeholder="#rrggbb"
          :value="overrideValue(row.key)"
          @input="onHexTextInput(row.key, $event)"
          @blur="onHexBlur(row.key, $event)"
        />
        <button
          class="accent-reset"
          :disabled="!store.accentOverrides[row.key]"
          :title="store.accentOverrides[row.key] ? t('settings.appearance.accentClearTitle') : t('settings.appearance.accentClearDisabledTitle')"
          @click="clearOverride(row.key)"
        >
          ×
        </button>
      </div>
    </div>

    <div v-if="!hasAnyOverride" class="accent-empty-hint">
      {{ t('settings.appearance.accentEmpty') }}
    </div>

    <div class="section-title section-title--spaced">
      {{ t('settings.appearance.separatorTitle') }}
      <span class="section-title-hint">{{ t('settings.appearance.separatorHint') }}</span>
    </div>
    <div class="separator-row">
      <span class="separator-label">{{ t('settings.appearance.separatorOpacity') }}</span>
      <input
        type="range"
        class="separator-range"
        :style="{ '--fill': separatorFillPercent }"
        :min="0"
        :max="ROW_SEPARATOR_MAX"
        :step="1"
        :value="store.rowSeparatorStrength"
        @input="onSeparatorStrengthInput"
      />
      <span class="separator-value">{{ separatorOpacityText }}</span>
      <button
        class="accent-reset"
        :disabled="separatorStrengthIsDefault"
        :title="separatorStrengthIsDefault ? t('settings.appearance.separatorResetAlready') : t('settings.appearance.separatorResetHint', { value: DEFAULT_SETTINGS.rowSeparatorStrength })"
        @click="resetSeparatorStrength"
      >
        ×
      </button>
    </div>
    <div class="theme-grid separator-style-grid">
      <label
        v-for="opt in separatorStyleOptions"
        :key="opt.value"
        class="theme-card"
        :class="{ 'is-active': store.rowSeparatorStyle === opt.value }"
      >
        <input
          type="radio"
          name="row-separator-style"
          :value="opt.value"
          :checked="store.rowSeparatorStyle === opt.value"
          @change="store.rowSeparatorStyle = opt.value"
        />
        <span class="theme-card-label">{{ opt.label }}</span>
      </label>
    </div>

    <div class="section-title section-title--spaced">
      {{ t('settings.appearance.rowHeightTitle') }}
      <span class="section-title-hint">{{ t('settings.appearance.rowHeightHint') }}</span>
    </div>
    <div class="row-height-row">
      <span class="separator-label">{{ t('settings.appearance.rowHeightLabel') }}</span>
      <input
        type="range"
        class="separator-range"
        :style="{ '--fill': historyRowHeightFillPercent }"
        :min="HISTORY_ROW_HEIGHT_MIN"
        :max="HISTORY_ROW_HEIGHT_MAX"
        :step="1"
        :value="store.historyRowHeight"
        @input="onHistoryRowHeightInput"
      />
      <input
        type="number"
        class="row-height-number"
        :min="HISTORY_ROW_HEIGHT_MIN"
        :max="HISTORY_ROW_HEIGHT_MAX"
        :step="1"
        :value="store.historyRowHeight"
        @input="onHistoryRowHeightInput"
      />
      <span class="row-height-unit">px</span>
      <button
        class="accent-reset"
        :disabled="historyRowHeightIsDefault"
        :title="historyRowHeightIsDefault ? t('settings.appearance.rowHeightResetAlready') : t('settings.appearance.rowHeightResetHint', { value: DEFAULT_SETTINGS.historyRowHeight })"
        @click="resetHistoryRowHeight"
      >
        ×
      </button>
    </div>

    <div class="section-title section-title--spaced">{{ t('settings.appearance.graphTitle') }}</div>
    <div class="theme-grid">
      <label
        v-for="opt in graphStyleOptions"
        :key="opt.value"
        class="theme-card"
        :class="{ 'is-active': store.graphStyle === opt.value }"
      >
        <input
          type="radio"
          name="graph-style"
          :value="opt.value"
          :checked="store.graphStyle === opt.value"
          @change="store.graphStyle = opt.value"
        />
        <span class="theme-card-label">{{ opt.label }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-title {
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--text-secondary);
  margin-top: 2px;
  margin-bottom: 8px;
  letter-spacing: 0.2px;
}

.section-title--spaced {
  margin-top: 18px;
}

.section-title-hint {
  font-weight: 400;
  color: var(--text-muted);
  margin-left: 6px;
  font-size: var(--font-sm);
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.theme-card {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
  background: var(--bg-primary);
  transition: border-color 0.1s, background 0.1s;
  min-width: 0;
}

.theme-card:hover {
  border-color: var(--text-muted);
}

.theme-card.is-active {
  border-color: var(--accent-blue);
  background: color-mix(in srgb, var(--accent-blue) 10%, var(--bg-primary));
}

.theme-card input[type="radio"] {
  accent-color: var(--accent-blue);
  margin: 0;
}

.theme-card-label {
  font-size: var(--font-md);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.accent-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.accent-row {
  display: grid;
  grid-template-columns: 1fr 32px 110px 28px;
  align-items: center;
  gap: 8px;
}

.accent-label {
  font-size: var(--font-md);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.accent-color {
  width: 32px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}

.accent-hex {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: var(--code-font-family);
  font-size: calc(11.5px * var(--font-scale));
  padding: 4px 8px;
  outline: none;
}

.accent-hex:focus {
  border-color: var(--accent-blue);
}

.accent-reset {
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-lg);
  line-height: 1;
}

.accent-reset:hover:not(:disabled) {
  color: var(--accent-red);
  border-color: var(--accent-red);
}

.accent-reset:disabled {
  opacity: 0.35;
  cursor: default;
}

.accent-empty-hint {
  margin-top: 6px;
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.separator-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 10px;
}

.separator-label {
  font-size: var(--font-md);
  color: var(--text-primary);
}

.separator-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  background: linear-gradient(
    to right,
    var(--accent-blue) 0%,
    var(--accent-blue) var(--fill, 0%),
    var(--border) var(--fill, 0%),
    var(--border) 100%
  );
}

.separator-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--bg-primary);
  border: 2px solid var(--accent-blue);
  cursor: pointer;
  transition: transform 0.1s;
}

.separator-range::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}

.separator-range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--bg-primary);
  border: 2px solid var(--accent-blue);
  cursor: pointer;
}

.separator-value {
  font-size: var(--font-sm);
  color: var(--text-muted);
  font-family: var(--code-font-family);
  min-width: 40px;
  text-align: right;
}

.separator-style-grid {
  margin-top: 8px;
}

.row-height-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto auto;
  align-items: center;
  gap: 10px;
}

.row-height-number {
  width: 56px;
  padding: 4px 6px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: var(--code-font-family);
  font-size: calc(11.5px * var(--font-scale));
  outline: none;
  text-align: right;
}

.row-height-number:focus {
  border-color: var(--accent-blue);
}

.row-height-unit {
  font-size: var(--font-sm);
  color: var(--text-muted);
  font-family: var(--code-font-family);
}
</style>
