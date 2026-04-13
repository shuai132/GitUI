<script setup lang="ts">
import { ref } from 'vue'
import Modal from '@/components/common/Modal.vue'
import { useErrorsStore } from '@/stores/errors'
import type { ErrorEntry } from '@/stores/errors'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const errorsStore = useErrorsStore()

// 展开查看原始错误的条目 id 集合
const expanded = ref(new Set<number>())

function toggle(id: number) {
  if (expanded.value.has(id)) {
    expanded.value.delete(id)
  } else {
    expanded.value.add(id)
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function onClear() {
  if (!confirm('清空所有错误记录？')) return
  errorsStore.clear()
}

function onCopy(entry: ErrorEntry) {
  const text = `[${entry.op}] ${entry.friendly}\n\n原始错误：\n${entry.raw}`
  navigator.clipboard.writeText(text)
}
</script>

<template>
  <Modal :visible="visible" title="最近错误" width="640px" @close="emit('close')">
    <div class="err-body">
      <div v-if="errorsStore.entries.length === 0" class="err-hint">
        暂无错误记录
      </div>
      <div v-else class="err-list">
        <div
          v-for="entry in errorsStore.entries"
          :key="entry.id"
          class="err-item"
        >
          <div class="err-head" @click="toggle(entry.id)">
            <span class="err-time">{{ formatTime(entry.ts) }}</span>
            <span class="err-op">{{ entry.op }}</span>
            <span class="err-friendly">{{ entry.friendly }}</span>
            <button
              class="err-copy"
              title="复制"
              @click.stop="onCopy(entry)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
          <pre v-if="expanded.has(entry.id)" class="err-raw">{{ entry.raw }}</pre>
        </div>
      </div>
    </div>
    <template #footer>
      <button
        class="btn-secondary"
        :disabled="errorsStore.entries.length === 0"
        @click="onClear"
      >
        清空
      </button>
      <button class="btn-close" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.err-body {
  min-height: 120px;
  max-height: 520px;
  overflow-y: auto;
}

.err-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  color: var(--text-muted);
  font-size: 13px;
}

.err-list {
  display: flex;
  flex-direction: column;
}

.err-item {
  border-bottom: 1px solid var(--border);
}

.err-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.1s;
}

.err-head:hover {
  background: var(--bg-overlay);
}

.err-time {
  color: var(--text-muted);
  font-family: var(--code-font-family, 'SF Mono', monospace);
  font-size: 11px;
  flex-shrink: 0;
  width: 110px;
}

.err-op {
  color: var(--accent-blue);
  font-family: var(--code-font-family, 'SF Mono', monospace);
  font-size: 11px;
  flex-shrink: 0;
  width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.err-friendly {
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.err-copy {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.err-copy:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.err-raw {
  margin: 0;
  padding: 8px 16px 10px 128px;
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-family: var(--code-font-family, 'SF Mono', monospace);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  border-top: 1px solid var(--border);
}

.btn-close,
.btn-secondary {
  padding: 5px 16px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.btn-close:hover,
.btn-secondary:hover:not(:disabled) {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.btn-secondary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
