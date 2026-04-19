<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  useShortcutsStore,
  SHORTCUT_DEFS,
  bindingToLabel,
  type ShortcutActionId,
  type KeyBinding,
} from '@/stores/shortcuts'

const { t } = useI18n()
const store = useShortcutsStore()

/** 正在录入新快捷键的 action id */
const recording = ref<ShortcutActionId | null>(null)

// ── 录制：用 document capture 监听，与焦点状态无关 ────────────────
let captureCleanup: (() => void) | null = null

function startRecord(id: ShortcutActionId) {
  // 先停掉旧的（防止重复点击）
  stopRecord()
  recording.value = id

  function captureKey(e: KeyboardEvent) {
    // 阻止事件传播，防止同时触发全局快捷键或 Modal 的 Escape 处理
    e.preventDefault()
    e.stopImmediatePropagation()

    if (e.key === 'Escape') {
      stopRecord()
      return
    }

    // 单独按下 modifier 键时忽略，等待组合键
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return

    const binding: KeyBinding = {
      key: e.key,
      ctrl: e.ctrlKey || undefined,
      meta: e.metaKey || undefined,
      shift: e.shiftKey || undefined,
      alt: e.altKey || undefined,
    }
    store.setBinding(id, binding)
    stopRecord()
  }

  document.addEventListener('keydown', captureKey, { capture: true })
  captureCleanup = () => document.removeEventListener('keydown', captureKey, { capture: true })
}

function stopRecord() {
  recording.value = null
  captureCleanup?.()
  captureCleanup = null
}

// 组件卸载时确保清理
onUnmounted(stopRecord)

function clearBinding(id: ShortcutActionId) {
  store.setBinding(id, null)
}

function resetBinding(id: ShortcutActionId) {
  store.resetBinding(id)
}

function resetAll() {
  store.resetAll()
}
</script>

<template>
  <div class="shortcuts-section">
    <div class="section-header">
      <span class="section-title">{{ t('shortcuts.title') }}</span>
      <button class="btn-reset-all" @click="resetAll">{{ t('shortcuts.resetAll') }}</button>
    </div>

    <div class="shortcut-list">
      <div
        v-for="def in SHORTCUT_DEFS"
        :key="def.id"
        class="shortcut-row"
      >
        <span class="shortcut-label">{{ t(def.labelKey) }}</span>
        <div class="shortcut-controls">
          <!-- 点击进入录制模式；录制期间再点一次取消 -->
          <button
            class="shortcut-key"
            :class="{ recording: recording === def.id }"
            @click="recording === def.id ? stopRecord() : startRecord(def.id)"
          >
            {{ recording === def.id ? t('shortcuts.pressKey') : bindingToLabel(store.bindings[def.id]) }}
          </button>
          <button
            class="btn-icon"
            :title="t('shortcuts.reset')"
            @click="resetBinding(def.id)"
          >↺</button>
          <button
            class="btn-icon btn-clear"
            :title="t('shortcuts.clear')"
            @click="clearBinding(def.id)"
          >×</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shortcuts-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.2px;
}

.btn-reset-all {
  font-size: var(--font-sm);
  color: var(--text-muted);
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
}
.btn-reset-all:hover {
  color: var(--text-primary);
  background: var(--bg-overlay);
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid var(--border);
  border-radius: 5px;
  overflow: hidden;
  background: var(--border);
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-primary);
}

.shortcut-label {
  font-size: var(--font-md);
  color: var(--text-primary);
  min-width: 0;
  flex: 1;
}

.shortcut-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.shortcut-key {
  min-width: 120px;
  padding: 3px 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: var(--font-sm);
  font-family: var(--code-font-family, monospace);
  color: var(--text-primary);
  cursor: pointer;
  text-align: center;
  transition: border-color 0.15s;
}

.shortcut-key.recording {
  border-color: var(--accent-blue);
  background: color-mix(in srgb, var(--accent-blue) 10%, var(--bg-surface));
  color: var(--accent-blue);
  outline: none;
  animation: pulse-border 1s ease-in-out infinite;
}

.shortcut-key:hover:not(.recording) {
  border-color: var(--accent-blue);
}

@keyframes pulse-border {
  0%, 100% { border-color: var(--accent-blue); }
  50% { border-color: color-mix(in srgb, var(--accent-blue) 40%, transparent); }
}

.btn-icon {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 3px;
  font-size: var(--font-md);
  padding: 0;
}
.btn-icon:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}
.btn-clear:hover {
  color: var(--accent-red);
}
</style>
