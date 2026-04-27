import { onUnmounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatAbsoluteTime } from '@/utils/format'
import type { CommitInfo } from '@/types/git'

export function useCommitTooltip() {
  const { t } = useI18n()
  const commitTooltip = reactive({
    visible: false,
    x: 0,
    y: 0,
    text: '',
  })
  let timer: number | null = null

  function commitPreview(commit: CommitInfo): string {
    return [
      commit.message.trim(),
      '',
      `${t('history.tooltip.author')}: ${commit.author_name} <${commit.author_email}>`,
      `${t('history.tooltip.date')}: ${formatAbsoluteTime(commit.time)}`,
      `${t('history.tooltip.commit')}: ${commit.short_oid}`,
    ].join('\n')
  }

  function showCommitTooltip(e: MouseEvent, commit: CommitInfo | undefined) {
    if (!commit) return
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      commitTooltip.text = commitPreview(commit)
      commitTooltip.x = e.clientX + 14
      commitTooltip.y = e.clientY + 14
      commitTooltip.visible = true
    }, 400)
  }

  function moveCommitTooltip(e: MouseEvent) {
    if (!commitTooltip.visible) return
    commitTooltip.x = e.clientX + 14
    commitTooltip.y = e.clientY + 14
  }

  function hideCommitTooltip() {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    commitTooltip.visible = false
  }

  onUnmounted(hideCommitTooltip)

  return {
    commitTooltip,
    showCommitTooltip,
    moveCommitTooltip,
    hideCommitTooltip,
  }
}
