<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

export interface ContextMenuItem {
  /** 分隔线：其他字段忽略 */
  separator?: boolean
  label?: string
  action?: string
  disabled?: boolean
  /** 高亮为"危险"操作（红色） */
  danger?: boolean
  /** 有 children 时，本项作为父项，hover 弹出二级子菜单（不再支持第三级） */
  children?: ContextMenuItem[]
  /** 鼠标悬停时展示的原生 tooltip；常用于解释为什么 disabled */
  title?: string
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

// ── 子菜单状态 ─────────────────────────────────────────────────────
const openSubmenuIndex = ref<number | null>(null)
let submenuCloseTimer: number | null = null

function clearSubmenuCloseTimer() {
  if (submenuCloseTimer !== null) {
    window.clearTimeout(submenuCloseTimer)
    submenuCloseTimer = null
  }
}

function onParentMouseEnter(idx: number) {
  clearSubmenuCloseTimer()
  openSubmenuIndex.value = idx
}

function onParentMouseLeave() {
  clearSubmenuCloseTimer()
  // 离开父项 150ms 后若未进入子菜单则关闭
  submenuCloseTimer = window.setTimeout(() => {
    openSubmenuIndex.value = null
    submenuCloseTimer = null
  }, 150)
}

function onSubmenuMouseEnter() {
  clearSubmenuCloseTimer()
}

function onSubmenuMouseLeave() {
  onParentMouseLeave()
}

// 非父项 hover 时关闭已展开的子菜单
function onNonParentMouseEnter() {
  clearSubmenuCloseTimer()
  openSubmenuIndex.value = null
}

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
  if (item.separator || item.disabled) return
  // 父项（有 children）点击自身不触发 select
  if (item.children && item.children.length > 0) return
  if (!item.action) return
  emit('select', item.action)
  emit('close')
}

// 点击 / Esc 关闭。用 pointerdown + capture：
// - capture 阶段触发，不会被触发点的 stopPropagation 绕过；
// - 跳过菜单自身和带 [data-menu-anchor] 的触发按钮（让按钮自行 toggle）。
function onDocumentPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return
  if (target.closest('.context-menu')) return
  if (target.closest('[data-menu-anchor]')) return
  emit('close')
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      // 下一轮事件循环注册，避免同一次 right-click / click 立刻被关闭
      setTimeout(() => {
        document.addEventListener('pointerdown', onDocumentPointerDown, true)
        document.addEventListener('keydown', onKey)
      }, 0)
    } else {
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
      document.removeEventListener('keydown', onKey)
      // 关闭时重置子菜单状态
      clearSubmenuCloseTimer()
      openSubmenuIndex.value = null
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('keydown', onKey)
  clearSubmenuCloseTimer()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="context-menu" :style="style" role="menu">
      <template v-for="(item, idx) in items" :key="idx">
        <div v-if="item.separator" class="menu-separator" />
        <div
          v-else-if="item.children && item.children.length > 0"
          class="menu-item menu-item--parent"
          :class="{
            'menu-item--disabled': item.disabled,
            'menu-item--danger': item.danger,
          }"
          @mouseenter="onParentMouseEnter(idx)"
          @mouseleave="onParentMouseLeave"
        >
          <span class="menu-item-label">{{ item.label }}</span>
          <span class="submenu-arrow">›</span>

          <div
            v-if="openSubmenuIndex === idx"
            class="submenu"
            @mouseenter="onSubmenuMouseEnter"
            @mouseleave="onSubmenuMouseLeave"
          >
            <template v-for="(child, cidx) in item.children" :key="cidx">
              <div v-if="child.separator" class="menu-separator" />
              <div
                v-else
                class="menu-item"
                :class="{
                  'menu-item--disabled': child.disabled,
                  'menu-item--danger': child.danger,
                }"
                @click="onItemClick(child)"
              >
                {{ child.label }}
              </div>
            </template>
          </div>
        </div>
        <div
          v-else
          class="menu-item"
          :class="{
            'menu-item--disabled': item.disabled,
            'menu-item--danger': item.danger,
          }"
          :title="item.title"
          @mouseenter="onNonParentMouseEnter"
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
  font-size: var(--font-md);
  user-select: none;
}

.menu-item {
  position: relative;
  padding: 6px 14px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
}

.menu-item--parent {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.menu-item-label {
  flex: 1;
  min-width: 0;
}

.submenu-arrow {
  opacity: 0.6;
  font-size: var(--font-base);
  line-height: 1;
}

.submenu {
  position: absolute;
  left: 100%;
  top: -5px;
  margin-left: -2px;
  min-width: 200px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 1001;
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
