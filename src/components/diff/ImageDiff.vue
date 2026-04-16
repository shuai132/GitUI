<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileDiff } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { mimeFor } from '@/lib/preview'

const { t } = useI18n()

const props = defineProps<{
  diff: FileDiff
  repoId: string
  /** WIP 场景传入；提交详情传 null */
  wip: { staged: boolean } | null
}>()

const { getBlobBytes, readWorktreeFile } = useGitCommands()

interface Side {
  state: 'idle' | 'loading' | 'loaded' | 'missing' | 'too-large' | 'error'
  dataUri: string
  size: number
  width: number
  height: number
  error?: string
}

function emptySide(): Side {
  return { state: 'idle', dataUri: '', size: 0, width: 0, height: 0 }
}

const oldSide = ref<Side>(emptySide())
const newSide = ref<Side>(emptySide())

const oldMime = computed(() => mimeFor(props.diff.old_path ?? props.diff.new_path))
const newMime = computed(() => mimeFor(props.diff.new_path ?? props.diff.old_path))

function setMissing(side: 'old' | 'new') {
  const target = side === 'old' ? oldSide : newSide
  target.value = { ...emptySide(), state: 'missing' }
}

function setError(side: 'old' | 'new', err: string) {
  const target = side === 'old' ? oldSide : newSide
  target.value = { ...emptySide(), state: 'error', error: err }
}

async function loadSide(side: 'old' | 'new') {
  const target = side === 'old' ? oldSide : newSide
  const mime = side === 'old' ? oldMime.value : newMime.value

  target.value = { ...emptySide(), state: 'loading' }

  try {
    let blob
    if (side === 'old') {
      if (!props.diff.old_blob_oid) return setMissing('old')
      blob = await getBlobBytes(props.repoId, props.diff.old_blob_oid, true)
    } else {
      // For unstaged/untracked WIP files, always read from the worktree.
      // diff_index_to_workdir computes new_blob_oid on-the-fly but never writes
      // the object to the store, so getBlobBytes would fail with "object not found".
      if (props.wip && !props.wip.staged && props.diff.new_path) {
        blob = await readWorktreeFile(props.repoId, props.diff.new_path, true)
      } else if (props.diff.new_blob_oid) {
        blob = await getBlobBytes(props.repoId, props.diff.new_blob_oid, true)
      } else {
        return setMissing('new')
      }
    }

    if (blob.truncated) {
      target.value = { ...emptySide(), state: 'too-large', size: blob.size }
      return
    }
    target.value = {
      state: 'loaded',
      dataUri: `data:${mime};base64,${blob.bytes_base64}`,
      size: blob.size,
      width: 0,
      height: 0,
    }
  } catch (e: any) {
    setError(side, e?.message ?? String(e))
  }
}

function onImgLoad(side: 'old' | 'new', ev: Event) {
  const img = ev.target as HTMLImageElement
  const target = side === 'old' ? oldSide : newSide
  target.value.width = img.naturalWidth
  target.value.height = img.naturalHeight
}

watch(
  () => [props.diff.old_blob_oid, props.diff.new_blob_oid, props.diff.new_path, props.repoId, props.wip?.staged],
  () => {
    loadSide('old')
    loadSide('new')
  },
  { immediate: true }
)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// expose 空方法占位，DiffView 在切到图片模式时会调，但图片预览不需要实际跳转
defineExpose({
  goNextChange: () => {},
  goPrevChange: () => {},
})
</script>

<template>
  <div class="img-diff">
    <div class="img-pane">
      <div class="pane-header">{{ t('diff.image.oldSide') }}</div>
      <div class="pane-body">
        <template v-if="oldSide.state === 'loading'">
          <div class="pane-state">{{ t('diff.empty.loading') }}</div>
        </template>
        <template v-else-if="oldSide.state === 'missing'">
          <div class="pane-state empty">{{ t('diff.image.added') }}</div>
        </template>
        <template v-else-if="oldSide.state === 'too-large'">
          <div class="pane-state warn">
            {{ t('diff.image.tooLarge', { size: formatSize(oldSide.size) }) }}
          </div>
        </template>
        <template v-else-if="oldSide.state === 'error'">
          <div class="pane-state error">{{ t('diff.image.loadFailed', { detail: oldSide.error }) }}</div>
        </template>
        <template v-else-if="oldSide.state === 'loaded'">
          <img :src="oldSide.dataUri" @load="onImgLoad('old', $event)" />
        </template>
      </div>
      <div class="pane-footer" v-if="oldSide.state === 'loaded'">
        {{ oldSide.width }}×{{ oldSide.height }} · {{ formatSize(oldSide.size) }}
      </div>
    </div>

    <div class="img-divider" />

    <div class="img-pane">
      <div class="pane-header">{{ t('diff.image.newSide') }}</div>
      <div class="pane-body">
        <template v-if="newSide.state === 'loading'">
          <div class="pane-state">{{ t('diff.empty.loading') }}</div>
        </template>
        <template v-else-if="newSide.state === 'missing'">
          <div class="pane-state empty">{{ t('diff.image.deleted') }}</div>
        </template>
        <template v-else-if="newSide.state === 'too-large'">
          <div class="pane-state warn">
            {{ t('diff.image.tooLarge', { size: formatSize(newSide.size) }) }}
          </div>
        </template>
        <template v-else-if="newSide.state === 'error'">
          <div class="pane-state error">{{ t('diff.image.loadFailed', { detail: newSide.error }) }}</div>
        </template>
        <template v-else-if="newSide.state === 'loaded'">
          <img :src="newSide.dataUri" @load="onImgLoad('new', $event)" />
        </template>
      </div>
      <div class="pane-footer" v-if="newSide.state === 'loaded'">
        {{ newSide.width }}×{{ newSide.height }} · {{ formatSize(newSide.size) }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.img-diff {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--bg-primary);
}

.img-pane {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.img-divider {
  width: 1px;
  background: var(--border);
  flex-shrink: 0;
}

.pane-header {
  padding: 6px 10px;
  font-size: var(--font-sm);
  color: var(--text-muted);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.pane-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 16px;
  min-height: 0;
  background:
    linear-gradient(45deg, rgba(128, 128, 128, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(128, 128, 128, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(128, 128, 128, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(128, 128, 128, 0.08) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}

.pane-body img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  image-rendering: auto;
}

.pane-state {
  color: var(--text-muted);
  font-size: var(--font-sm);
  text-align: center;
}

.pane-state.empty {
  color: var(--text-muted);
  font-style: italic;
}

.pane-state.warn {
  color: var(--accent-orange);
}

.pane-state.error {
  color: var(--accent-red);
}

.pane-footer {
  padding: 4px 10px;
  font-size: var(--font-xs, 11px);
  color: var(--text-muted);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  font-family: var(--code-font-family, 'SF Mono', monospace);
  text-align: center;
}
</style>
