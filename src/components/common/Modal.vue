<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  title?: string
  width?: string
  height?: string
  bodyClass?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const overlayRef = ref<HTMLElement | null>(null)

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
  if (e.key !== 'Escape') return
  if (isShortcutRecording() || !isTopmostModal()) return

  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()
  emit('close')
}

watch(
  () => props.visible,
  (v) => {
    if (v) document.addEventListener('keydown', onKey, { capture: true })
    else document.removeEventListener('keydown', onKey, { capture: true })
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey, { capture: true })
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
        <div class="modal-box" :style="{ width: width ?? '460px', height }">
          <div v-if="title || $slots.header" class="modal-header">
            <slot name="header">
              <div class="modal-title">{{ title }}</div>
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
