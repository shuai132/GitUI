import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'warning'

const toast = ref<{ type: ToastType; message: string } | null>(null)
let toastTimer: number | null = null

export function useGlobalToast() {
  function showToast(type: ToastType, msg: string) {
    toast.value = { type, message: msg }
    if (toastTimer !== null) window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => {
      toast.value = null
      toastTimer = null
    }, 3000)
  }

  function showError(msg: string) {
    showToast('error', msg)
  }

  return {
    toast,
    showToast,
    showError,
  }
}
