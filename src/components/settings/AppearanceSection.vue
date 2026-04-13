<script setup lang="ts">
import { computed } from 'vue'
import {
  ROW_SEPARATOR_MAX,
  clampSeparatorStrength,
  useSettingsStore,
  type AccentKey,
  type GraphStyle,
  type RowSeparatorStyle,
  type ThemeMode,
} from '@/stores/settings'

const store = useSettingsStore()

const themeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

const graphStyleOptions: Array<{ value: GraphStyle; label: string }> = [
  { value: 'rounded', label: '圆润' },
  { value: 'step', label: '直角' },
  { value: 'angular', label: '锐角' },
]

const separatorStyleOptions: Array<{ value: RowSeparatorStyle; label: string }> = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
]

function onSeparatorStrengthInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  store.rowSeparatorStrength = clampSeparatorStrength(v)
}

interface AccentRow {
  key: AccentKey
  label: string
  /** 当前默认值（未覆盖时页面使用的值），仅用于颜色拾取器的初始值 */
}

const accentRows: AccentRow[] = [
  { key: 'blue', label: '主强调（链接 / hash）' },
  { key: 'green', label: '增加 / 成功' },
  { key: 'red', label: '删除 / 危险' },
  { key: 'yellow', label: '警告' },
  { key: 'orange', label: '次要强调' },
]

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
    <div class="section-title">主题</div>
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
      强调色覆盖
      <span class="section-title-hint">（留空使用主题默认）</span>
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
          :title="store.accentOverrides[row.key] ? '清除覆盖' : '未覆盖'"
          @click="clearOverride(row.key)"
        >
          ×
        </button>
      </div>
    </div>

    <div v-if="!hasAnyOverride" class="accent-empty-hint">
      当前未覆盖任何强调色，使用主题内置配色。
    </div>

    <div class="section-title section-title--spaced">
      行分隔线
      <span class="section-title-hint">（提交历史每行之间）</span>
    </div>
    <div class="separator-row">
      <span class="separator-label">强度</span>
      <input
        type="range"
        class="separator-range"
        :min="0"
        :max="ROW_SEPARATOR_MAX"
        :step="1"
        :value="store.rowSeparatorStrength"
        @input="onSeparatorStrengthInput"
      />
      <span class="separator-value">
        {{ store.rowSeparatorStrength === 0 ? '无' : `${store.rowSeparatorStrength} / ${ROW_SEPARATOR_MAX}` }}
      </span>
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

    <div class="section-title section-title--spaced">提交图</div>
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
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
}

.separator-label {
  font-size: var(--font-md);
  color: var(--text-primary);
}

.separator-range {
  accent-color: var(--accent-blue);
  width: 100%;
}

.separator-value {
  font-size: var(--font-sm);
  color: var(--text-muted);
  font-family: var(--code-font-family);
  min-width: 48px;
  text-align: right;
}

.separator-style-grid {
  margin-top: 8px;
}
</style>
