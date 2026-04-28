<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommitChangeStats } from '@/types/git'
import { formatBytes } from '@/utils/format'

const { t, locale } = useI18n()

type WipChangeStats = {
  files_changed: number
  additions: number
  deletions: number
}

const props = defineProps<{
  stats?: CommitChangeStats
  wipStats?: WipChangeStats
  loading?: boolean
  failed?: boolean
}>()

const displayStats = computed(() => props.stats ?? props.wipStats)

const filesText = computed(() => {
  const count = displayStats.value?.files_changed ?? 0
  if (!locale.value.startsWith('en')) return t('history.changeStats.files', { count })
  return count === 1
    ? t('history.changeStats.fileSingular', { count })
    : t('history.changeStats.filePlural', { count })
})

const title = computed(() => {
  const stats = props.stats
  if (!stats) return ''

  const bits = [
    t('history.changeStats.filesTitle', { count: stats.files_changed }),
    t('history.changeStats.additionsTitle', { count: stats.additions }),
    t('history.changeStats.deletionsTitle', { count: stats.deletions }),
  ]
  if (stats.binary_files > 0) {
    bits.push(t('history.changeStats.binaryTitle', { count: stats.binary_files }))
  }
  if (stats.large_blob_count > 0) {
    bits.push(t('history.changeStats.largeTitle', {
      count: stats.large_blob_count,
      size: formatBytes(stats.large_blob_bytes),
      largest: formatBytes(stats.largest_blob_bytes),
    }))
  }
  return bits.join('\n')
})

const largeBadge = computed(() => {
  const stats = props.stats
  if (!stats || stats.large_blob_count === 0) return ''
  return `BIG ${formatBytes(stats.largest_blob_bytes)}`
})
</script>

<template>
  <div class="change-stats-cell" :title="title || undefined">
    <template v-if="displayStats">
      <span class="change-files">{{ filesText }}</span>
      <span class="change-add" :class="{ muted: displayStats.additions === 0 }">
        <template v-if="displayStats.additions > 0">+{{ displayStats.additions }}</template>
      </span>
      <span class="change-del" :class="{ muted: displayStats.deletions === 0 }">
        <template v-if="displayStats.deletions > 0">-{{ displayStats.deletions }}</template>
      </span>
      <span class="change-badges">
        <span
          v-if="stats && stats.binary_files > 0"
          class="change-badge change-badge-bin"
          :title="t('history.changeStats.binaryTitle', { count: stats.binary_files })"
        >BIN</span>
        <span
          v-if="largeBadge"
          class="change-badge change-badge-big"
          :title="title"
        >{{ largeBadge }}</span>
      </span>
    </template>

    <span
      v-else-if="failed"
      class="change-stats-failed"
      :title="t('history.changeStats.failed')"
    >!</span>
    <span v-else-if="loading" class="change-stats-placeholder">...</span>
    <span v-else class="change-stats-placeholder">...</span>
  </div>
</template>

<style scoped>
.change-stats-cell {
  display: grid;
  grid-template-columns: 6.2ch 4.4ch 4.4ch minmax(0, max-content);
  column-gap: 4px;
  align-items: center;
  justify-content: start;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  font-variant-numeric: tabular-nums;
}

.change-files {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--change-files-color, var(--text-muted));
}

.change-add,
.change-del {
  text-align: left;
  min-width: 0;
}

.change-add {
  color: var(--change-add-color, var(--accent-green));
}

.change-del {
  color: var(--change-del-color, var(--accent-red));
}

.change-add.muted,
.change-del.muted {
  color: transparent;
}

.change-badges {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.change-badge {
  flex-shrink: 0;
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 4px;
  line-height: 14px;
  font-size: var(--font-xs);
  font-weight: 700;
}

.change-badge-bin {
  color: var(--change-bin-color, var(--accent-orange));
}

.change-badge-big {
  color: var(--change-big-color, var(--accent-yellow));
  overflow: hidden;
  text-overflow: ellipsis;
}

.change-stats-placeholder {
  grid-column: 1 / -1;
  color: var(--change-placeholder-color, var(--text-muted));
  opacity: 0.65;
}

.change-stats-failed {
  grid-column: 1 / -1;
  color: var(--change-failed-color, var(--accent-red));
  font-weight: 700;
}
</style>
