<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useWindowSize } from '@vueuse/core'

export interface ContextMenuItem {
  /** 分隔线：其他字段忽略 */
  separator?: boolean
  label?: string
  action?: string
  disabled?: boolean
  /** 高亮为"危险"操作（红色） */
  danger?: boolean
  /** 行尾轻量操作，适合对当前菜单项做辅助设置 */
  trailingLabel?: string
  trailingAction?: string
  trailingTitle?: string
  trailingDisabled?: boolean
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

const { width: windowWidth, height: windowHeight } = useWindowSize()

// ── 子菜单状态 ─────────────────────────────────────────────────────
const openSubmenuIndex = ref<number | null>(null)
const submenuSide = ref<'right' | 'left'>('right')
const submenuVPos = ref<'top' | 'bottom'>('top')
let submenuCloseTimer: number | null = null
let pendingOutsideClickBlocker: ((event: MouseEvent) => void) | null = null
let listenerSetupTimer: number | null = null
let previouslyFocused: HTMLElement | null = null
const menuRef = ref<HTMLElement | null>(null)
const submenuRef = ref<HTMLElement | null>(null)

const submenuStyles = ref<Record<string, string>>({})

function clearSubmenuCloseTimer() {
  if (submenuCloseTimer !== null) {
    window.clearTimeout(submenuCloseTimer)
    submenuCloseTimer = null
  }
}

function clearPendingOutsideClickBlocker() {
  if (pendingOutsideClickBlocker !== null) {
    document.removeEventListener('click', pendingOutsideClickBlocker, true)
    pendingOutsideClickBlocker = null
  }
}

function blockNextOutsideClick() {
  clearPendingOutsideClickBlocker()
  pendingOutsideClickBlocker = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    clearPendingOutsideClickBlocker()
  }
  document.addEventListener('click', pendingOutsideClickBlocker, true)
}

function openSubmenu(idx: number, parent: HTMLElement) {
  clearSubmenuCloseTimer()
  const item = props.items[idx]
  if (item.disabled || !item.children) return
  openSubmenuIndex.value = idx

  // 检测子菜单弹出方向 (水平)
  const SUBMENU_W = 200
  const parentRect = parent.getBoundingClientRect()
  
  const styles: Record<string, string> = {}
  
  if (parentRect.right + SUBMENU_W > windowWidth.value - 10) {
    submenuSide.value = 'left'
    styles.right = `${windowWidth.value - parentRect.left + 2}px`
  } else {
    submenuSide.value = 'right'
    styles.left = `${parentRect.right - 2}px`
  }

  // 检测子菜单弹出方向 (垂直)
  const estSubmenuHeight = item.children.reduce(
    (h, it) => h + (it.separator ? 9 : 30),
    10, // padding
  )
  if (parentRect.top + estSubmenuHeight > windowHeight.value - 10) {
    submenuVPos.value = 'bottom'
    styles.bottom = `${windowHeight.value - parentRect.bottom + 5}px`
  } else {
    submenuVPos.value = 'top'
    styles.top = `${parentRect.top - 5}px`
  }
  
  submenuStyles.value = styles
}

function onParentMouseEnter(idx: number, e: MouseEvent) {
  openSubmenu(idx, e.currentTarget as HTMLElement)
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
  const MENU_ITEM_H = 30 // 稍微调大一点，确保安全
  const hPad = 12
  const estHeight = props.items.reduce(
    (h, it) => h + (it.separator ? 9 : MENU_ITEM_H),
    hPad,
  )
  const maxX = windowWidth.value - MENU_MIN_W - 8
  const maxY = windowHeight.value - estHeight - 8
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

function onTrailingActionClick(item: ContextMenuItem) {
  if (item.separator || item.disabled || item.trailingDisabled) return
  if (!item.trailingAction) return
  emit('select', item.trailingAction)
  emit('close')
}

function enabledMenuItems(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>('[data-menu-item="true"]')).filter(
    (item) => item.getAttribute('aria-disabled') !== 'true',
  )
}

function focusAt(items: HTMLElement[], index: number) {
  if (items.length === 0) return
  items[(index + items.length) % items.length]?.focus()
}

async function openSubmenuFromKeyboard(parent: HTMLElement) {
  const idx = Number(parent.dataset.itemIndex)
  if (!Number.isInteger(idx)) return
  openSubmenu(idx, parent)
  await nextTick()
  enabledMenuItems(submenuRef.value)[0]?.focus()
}

function restorePreviousFocus() {
  const target = previouslyFocused
  previouslyFocused = null
  if (target?.isConnected) target.focus()
}

// 点击 / Esc 关闭。用 pointerdown + capture：
// - capture 阶段触发，不会被触发点的 stopPropagation 绕过；
// - 跳过菜单自身和带 [data-menu-anchor] 的触发按钮（让按钮自行 toggle）。
function onDocumentPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return
  if (target.closest('.context-menu')) return
  if (target.closest('.submenu')) return
  if (target.closest('[data-menu-anchor]')) return

  if (e.button === 0) {
    e.preventDefault()
    e.stopPropagation()
    blockNextOutsideClick()
  }
  emit('close')
}
function onKey(e: KeyboardEvent) {
  if (
    ![
      'Escape',
      'ArrowDown',
      'ArrowUp',
      'Home',
      'End',
      'ArrowRight',
      'ArrowLeft',
      'Enter',
      ' ',
      'Tab',
    ].includes(e.key)
  ) {
    return
  }
  e.stopPropagation()
  e.stopImmediatePropagation()
  const target = e.target instanceof HTMLElement
    ? e.target
    : document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  const inSubmenu = !!target?.closest('.submenu')
  const container = inSubmenu ? submenuRef.value : menuRef.value
  const items = enabledMenuItems(container)
  const currentItem = target?.closest<HTMLElement>('[data-menu-item="true"]') ?? null
  const currentIndex = currentItem ? items.indexOf(currentItem) : -1

  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    focusAt(items, currentIndex + 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    focusAt(items, currentIndex < 0 ? items.length - 1 : currentIndex - 1)
  } else if (e.key === 'Home') {
    e.preventDefault()
    focusAt(items, 0)
  } else if (e.key === 'End') {
    e.preventDefault()
    focusAt(items, items.length - 1)
  } else if (e.key === 'ArrowRight' && currentItem) {
    const trailing = currentItem.querySelector<HTMLElement>('.menu-item-trailing:not(:disabled)')
    if (currentItem.getAttribute('aria-haspopup') === 'menu') {
      e.preventDefault()
      void openSubmenuFromKeyboard(currentItem)
    } else if (trailing) {
      e.preventDefault()
      trailing.focus()
    }
  } else if (e.key === 'ArrowLeft') {
    if (target?.classList.contains('menu-item-trailing')) {
      e.preventDefault()
      currentItem?.focus()
    } else if (inSubmenu) {
      e.preventDefault()
      const parent = menuRef.value?.querySelector<HTMLElement>(
        `[data-item-index="${openSubmenuIndex.value}"]`,
      )
      openSubmenuIndex.value = null
      parent?.focus()
    }
  } else if ((e.key === 'Enter' || e.key === ' ') && currentItem) {
    if (target?.classList.contains('menu-item-trailing')) return
    e.preventDefault()
    if (currentItem.getAttribute('aria-haspopup') === 'menu') {
      void openSubmenuFromKeyboard(currentItem)
    } else {
      currentItem.click()
    }
  } else if (e.key === 'Tab') {
    e.preventDefault()
    emit('close')
  }
}

function clearListenerSetupTimer() {
  if (listenerSetupTimer !== null) {
    window.clearTimeout(listenerSetupTimer)
    listenerSetupTimer = null
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      previouslyFocused = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      void nextTick(() => enabledMenuItems(menuRef.value)[0]?.focus())
      // 下一轮事件循环注册，避免同一次 right-click / click 立刻被关闭
      clearListenerSetupTimer()
      listenerSetupTimer = window.setTimeout(() => {
        listenerSetupTimer = null
        if (!props.visible) return
        document.addEventListener('pointerdown', onDocumentPointerDown, true)
        window.addEventListener('keydown', onKey, { capture: true })
      }, 0)
    } else {
      clearListenerSetupTimer()
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
      window.removeEventListener('keydown', onKey, { capture: true })
      // 关闭时重置子菜单状态
      clearSubmenuCloseTimer()
      openSubmenuIndex.value = null
      restorePreviousFocus()
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('keydown', onKey, { capture: true })
  clearListenerSetupTimer()
  clearSubmenuCloseTimer()
  clearPendingOutsideClickBlocker()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" ref="menuRef" class="context-menu" :style="style" role="menu">
      <template v-for="(item, idx) in items" :key="idx">
        <div v-if="item.separator" class="menu-separator" role="separator" />
        <div
          v-else-if="item.children && item.children.length > 0"
          class="menu-item menu-item--parent"
          :class="{
            'menu-item--disabled': item.disabled,
            'menu-item--danger': item.danger,
          }"
          role="menuitem"
          tabindex="-1"
          data-menu-item="true"
          :data-item-index="idx"
          aria-haspopup="menu"
          :aria-expanded="openSubmenuIndex === idx"
          :aria-disabled="item.disabled || undefined"
          @mouseenter="onParentMouseEnter(idx, $event)"
          @mouseleave="onParentMouseLeave"
        >
          <span class="menu-item-label">{{ item.label }}</span>
          <span class="submenu-arrow">›</span>
        </div>
        <div
          v-else
          class="menu-item menu-item--leaf"
          :class="{
            'menu-item--disabled': item.disabled,
            'menu-item--danger': item.danger,
          }"
          :title="item.title"
          role="menuitem"
          tabindex="-1"
          data-menu-item="true"
          :data-item-index="idx"
          :aria-disabled="item.disabled || undefined"
          @mouseenter="onNonParentMouseEnter"
          @click="onItemClick(item)"
        >
          <span class="menu-item-label">{{ item.label }}</span>
          <button
            v-if="item.trailingLabel && item.trailingAction"
            type="button"
            class="menu-item-trailing"
            tabindex="-1"
            :disabled="item.disabled || item.trailingDisabled"
            :title="item.trailingTitle"
            @click.stop="onTrailingActionClick(item)"
          >
            {{ item.trailingLabel }}
          </button>
        </div>
      </template>
    </div>

    <div
      v-if="visible && openSubmenuIndex !== null && items[openSubmenuIndex]?.children?.length"
      ref="submenuRef"
      class="submenu"
      role="menu"
      :style="submenuStyles"
      @mouseenter="onSubmenuMouseEnter"
      @mouseleave="onSubmenuMouseLeave"
    >
      <template v-for="(child, cidx) in items[openSubmenuIndex].children" :key="cidx">
        <div v-if="child.separator" class="menu-separator" role="separator" />
        <div
          v-else
          class="menu-item"
          :class="{
            'menu-item--disabled': child.disabled,
            'menu-item--danger': child.danger,
          }"
          role="menuitem"
          tabindex="-1"
          data-menu-item="true"
          :data-item-index="cidx"
          :aria-disabled="child.disabled || undefined"
          @click="onItemClick(child)"
        >
          {{ child.label }}
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  min-width: 180px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
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

.menu-item--leaf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.menu-item-label {
  flex: 1;
  min-width: 0;
}

.menu-item-trailing {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--accent-blue);
  font: inherit;
  font-size: var(--font-sm);
  line-height: 1;
  padding: 2px 0 2px 8px;
  cursor: pointer;
}

.menu-item-trailing:hover:not(:disabled) {
  color: var(--text-primary);
}

.menu-item-trailing:disabled {
  color: var(--text-muted);
  cursor: default;
}

.submenu-arrow {
  opacity: 0.6;
  font-size: var(--font-base);
  line-height: 1;
}

.submenu {
  position: fixed;
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

.menu-item:focus {
  outline: none;
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

.menu-item--danger:focus {
  background: rgba(237, 135, 150, 0.15);
}

.menu-item-trailing:focus-visible {
  outline: 1px solid var(--accent-blue);
  outline-offset: 2px;
}

.menu-separator {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
</style>
