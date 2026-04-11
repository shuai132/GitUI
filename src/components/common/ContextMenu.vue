<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'

export interface ContextMenuItem {
  /** 分隔线：其他字段忽略 */
  separator?: boolean
  label?: string
  action?: string
  disabled?: boolean
  /** 高亮为"危险"操作（红色） */
  danger?: boolean
}

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}>()

const emit = defineEmits<{
  close: []
  select: [action: string]
}>()

// 将菜单位置向左/向上偏移以避免超出窗口
const style = computed(() => {
  // 用 inline top/left；若溢出浏览器视口右/下边，反向偏移
  const MENU_MIN_W = 180
  const MENU_ITEM_H = 28
  const hPad = 12
  const estHeight = props.items.reduce(
    (h, it) => h + (it.separator ? 7 : MENU_ITEM_H),
    hPad,
  )
  const maxX = window.innerWidth - MENU_MIN_W - 8
  const maxY = window.innerHeight - estHeight - 8
  return {
    left: Math.max(4, Math.min(props.x, maxX)) + 'px',
    top: Math.max(4, Math.min(props.y, maxY)) + 'px',
  }
})

function onItemClick(item: ContextMenuItem) {
  if (item.separator || item.disabled || !item.action) return
  emit('select', item.action)
  emit('close')
}

// 点击 / Esc 关闭
function onDocumentMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.context-menu')) return
  emit('close')
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      // 下一轮事件循环注册，避免同一次 right-click 立刻被关闭
      setTimeout(() => {
        document.addEventListener('mousedown', onDocumentMouseDown)
        document.addEventListener('keydown', onKey)
      }, 0)
    } else {
      document.removeEventListener('mousedown', onDocumentMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="context-menu" :style="style" role="menu">
      <template v-for="(item, idx) in items" :key="idx">
        <div v-if="item.separator" class="menu-separator" />
        <div
          v-else
          class="menu-item"
          :class="{
            'menu-item--disabled': item.disabled,
            'menu-item--danger': item.danger,
          }"
          @click="onItemClick(item)"
        >
          {{ item.label }}
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  min-width: 180px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  font-size: 12px;
  user-select: none;
}

.menu-item {
  padding: 6px 14px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
}

.menu-item:hover {
  background: rgba(138, 173, 244, 0.15);
  color: var(--text-primary);
}

.menu-item--disabled {
  color: var(--text-muted);
  cursor: default;
  opacity: 0.5;
}

.menu-item--disabled:hover {
  background: none;
  color: var(--text-muted);
}

.menu-item--danger {
  color: var(--accent-red);
}

.menu-item--danger:hover {
  background: rgba(237, 135, 150, 0.15);
}

.menu-separator {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
</style>
