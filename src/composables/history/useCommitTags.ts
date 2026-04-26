import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHistoryStore } from '@/stores/history'
import type { BranchInfo, TagInfo } from '@/types/git'

export function useCommitTags() {
  const { t } = useI18n()
  const historyStore = useHistoryStore()

  // ── Branch tag map (oid → branches pointing to this commit) ─────────
  const branchTagMap = computed(() => {
    const map = new Map<string, BranchInfo[]>()
    for (const b of historyStore.branches) {
      if (b.commit_oid) {
        if (!map.has(b.commit_oid)) map.set(b.commit_oid, [])
        map.get(b.commit_oid)!.push(b)
      }
    }
    return map
  })

  function branchTagColor(b: BranchInfo): string {
    if (b.is_head) return 'var(--accent-blue)'
    if (b.is_remote) return 'var(--accent-orange)'
    return 'var(--accent-green)'
  }

  // ── Tag chip map (oid → tags pointing to this commit) ──────────────
  const tagsByCommit = computed(() => {
    const map = new Map<string, TagInfo[]>()
    for (const t of historyStore.tags) {
      if (!map.has(t.commit_oid)) map.set(t.commit_oid, [])
      map.get(t.commit_oid)!.push(t)
    }
    const localTagNames = new Set(historyStore.tags.map(t => t.name))
    for (const t of historyStore.remoteTags) {
      if (!localTagNames.has(t.name)) {
        if (!map.has(t.commit_oid)) map.set(t.commit_oid, [])
        map.get(t.commit_oid)!.push(t)
      }
    }
    return map
  })

  type TagRemoteStatus = 'synced' | 'local_only' | 'unknown'

  function tagRemoteStatus(tag: TagInfo): TagRemoteStatus {
    if (!historyStore.remoteTagsChecked) return 'unknown'
    return historyStore.remoteTagNames.has(tag.name) ? 'synced' : 'local_only'
  }

  function tagStatusLabel(status: TagRemoteStatus): string {
    switch (status) {
      case 'synced':
        return t('history.tag.status.synced')
      case 'local_only':
        return t('history.tag.status.localOnly')
      default:
        return t('history.tag.status.unknown')
    }
  }

  function tagChipTitle(tag: TagInfo): string {
    const head = tag.is_annotated
      ? `🏷 ${tag.name} (${t('history.tag.annotated')})`
      : `🏷 ${tag.name}`
    const status = `[${tagStatusLabel(tagRemoteStatus(tag))}]`
    const body = `${head} ${status}`
    return tag.message ? `${body}\n\n${tag.message}` : body
  }

  return {
    branchTagMap,
    branchTagColor,
    tagsByCommit,
    tagRemoteStatus,
    tagChipTitle,
  }
}
