<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  title?: string
  width?: string
  height?: string
  bodyClass?: string
  ariaLabel?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const overlayRef = ref<HTMLElement | null>(null)
const boxRef = ref<HTMLElement | null>(null)
const titleRef = ref<HTMLElement | null>(null)
const titleId = `modal-title-${useId()}`
let previouslyFocused: HTMLElement | null = null

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(): HTMLElement[] {
  const box = boxRef.value
  if (!box) return []
  return Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
  )
}

function isShortcutRecording() {
  return document.querySelector('.shortcut-key.recording') !== null
}

function isTopmostModal() {
  const overlay = overlayRef.value
  if (!overlay) return false
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('[data-modal-overlay="true"]'))
  return overlays[overlays.length - 1] === overlay
}

function onKey(e: KeyboardEvent) {
  if (!isTopmostModal()) return
  if (e.key === 'Escape') {
    if (isShortcutRecording()) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    emit('close')
    return
  }
  if (e.key !== 'Tab') return

  const focusable = focusableElements()
  if (focusable.length === 0) {
    e.preventDefault()
    titleRef.value?.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  const activeIndex = focusable.indexOf(active as HTMLElement)
  if (e.shiftKey && (active === first || activeIndex < 0)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || activeIndex < 0)) {
    e.preventDefault()
    first.focus()
  }
}

async function focusInitialElement() {
  await nextTick()
  if (!props.visible || !isTopmostModal()) return
  const focusable = focusableElements()
  const target = focusable[0] ?? titleRef.value
  target?.focus()
}

function restorePreviousFocus() {
  const overlay = overlayRef.value
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('[data-modal-overlay="true"]'))
  if (overlays[overlays.length - 1] !== overlay) {
    previouslyFocused = null
    return
  }
  const target = previouslyFocused
  previouslyFocused = null
  if (target?.isConnected) target.focus()
}

watch(
  () => props.visible,
  (v, wasVisible) => {
    if (v) {
      previouslyFocused = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      document.addEventListener('keydown', onKey, { capture: true })
      void focusInitialElement()
    } else {
      document.removeEventListener('keydown', onKey, { capture: true })
      if (wasVisible) restorePreviousFocus()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey, { capture: true })
  if (props.visible) restorePreviousFocus()
})

function onOverlayClick() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        ref="overlayRef"
        class="modal-overlay"
        data-modal-overlay="true"
        @mousedown.self="onOverlayClick"
      >
        <div
          ref="boxRef"
          class="modal-box"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="title ? titleId : undefined"
          :aria-label="title ? undefined : ariaLabel"
          :style="{ width: width ?? '460px', height }"
        >
          <div v-if="title || $slots.header" class="modal-header">
            <slot name="header">
              <div :id="titleId" ref="titleRef" class="modal-title" tabindex="-1">
                {{ title }}
              </div>
            </slot>
          </div>
          <div class="modal-body" :class="bodyClass">
            <slot />
          </div>
          <div v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 900;
}

.modal-box {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  overflow: hidden;
}

.modal-header {
  padding: 14px 18px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.modal-title {
  font-size: var(--font-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.modal-body {
  padding: 16px 18px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.modal-body--contained-scroll {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.modal-footer {
  padding: 10px 18px 14px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
