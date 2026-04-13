<script setup lang="ts">
import { computed } from 'vue'
import {
  EXTERNAL_TERMINAL_PRESETS,
  useSettingsStore,
  type ExternalTerminal,
} from '@/stores/settings'

const store = useSettingsStore()

const options = EXTERNAL_TERMINAL_PRESETS

const isCustom = computed(() => store.externalTerminal === 'custom')

function onSelect(e: Event) {
  const v = (e.target as HTMLSelectElement).value as ExternalTerminal
  store.externalTerminal = v
}

function onCustomInput(e: Event) {
  store.externalTerminalCustom = (e.target as HTMLInputElement).value
}

// 仅 macOS 下该配置生效，其它平台保持自动探测逻辑
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
</script>

<template>
  <div class="section">
    <div class="section-title">终端</div>
    <div class="tool-row">
      <label class="tool-label" for="external-terminal-select">外部终端</label>
      <select
        id="external-terminal-select"
        class="tool-select"
        :value="store.externalTerminal"
        @change="onSelect"
      >
        <option v-for="opt in options" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </div>

    <div v-if="isCustom" class="tool-row tool-row--custom">
      <label class="tool-label" for="external-terminal-custom">应用名 / Bundle ID</label>
      <input
        id="external-terminal-custom"
        class="tool-input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="例如：Alacritty、Hyper、com.mitchellh.ghostty"
        :value="store.externalTerminalCustom"
        @input="onCustomInput"
      />
    </div>

    <div class="section-hint">
      <template v-if="isMac">
        通过 <code>open -a</code> 启动所选应用，须先安装对应程序。
      </template>
      <template v-else>
        当前平台不使用该设置，将自动探测可用终端。
      </template>
    </div>
  </div>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 2px;
  letter-spacing: 0.2px;
}

.tool-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  align-items: center;
  gap: 12px;
}

.tool-label {
  font-size: var(--font-md);
  color: var(--text-primary);
}

.tool-select,
.tool-input {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-md);
  padding: 5px 8px;
  outline: none;
  width: 100%;
}

.tool-select:focus,
.tool-input:focus {
  border-color: var(--accent-blue);
}

.section-hint {
  margin-top: 2px;
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.section-hint code {
  font-family: var(--code-font-family);
  background: var(--bg-overlay);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: calc(10.5px * var(--font-scale));
}
</style>
