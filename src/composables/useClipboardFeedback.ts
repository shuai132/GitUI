import { useGlobalToast } from '@/composables/useGlobalToast'

type Translate = (key: string) => string

export interface ClipboardFeedbackOptions {
  successMessage?: string
  failureMessage?: string
}

export function useClipboardFeedback(t: Translate) {
  const { showToast, showActionError } = useGlobalToast()

  async function copyText(
    text: string,
    options: ClipboardFeedbackOptions = {},
  ): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      showToast('success', options.successMessage ?? t('clipboard.copySuccess'))
      return true
    } catch (error: unknown) {
      showActionError(error, options.failureMessage ?? t('clipboard.copyFailed'))
      return false
    }
  }

  return { copyText }
}
