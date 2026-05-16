import { onBeforeUnmount, onMounted, type Ref } from 'vue'

export function useBlurOnOutsidePointerDown(
  rootEl: Ref<HTMLElement | null>,
  onBlurred?: () => void,
) {
  function onDocumentPointerDown(e: PointerEvent) {
    const root = rootEl.value
    const active = document.activeElement
    const target = e.target

    if (!root || !active || !(target instanceof Node)) return
    if (!root.contains(active) || root.contains(target)) return
    if (!(active instanceof HTMLElement)) return

    active.blur()
    onBlurred?.()
  }

  onMounted(() => {
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  })
}
