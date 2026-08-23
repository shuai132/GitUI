<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from '@/stores/repos'
import type { ReflogEntry } from '@/types/git'

const { t, locale } = useI18n()

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const git = useGitCommands()
const { copyText } = useClipboardFeedback(t)
const repoStore = useRepoStore()

const entries = ref<ReflogEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
let loadSeq = 0
const activeRepoName = computed(() => repoStore.activeRepo()?.name ?? '')
const title = computed(() => activeRepoName.value
  ? t('reflog.titleWithRepo', { repo: activeRepoName.value })
  : t('reflog.title'))

watch(
  [() => props.visible, () => repoStore.activeRepoId],
  async ([visible, repoId]) => {
    const seq = ++loadSeq
    entries.value = []
    error.value = null
    if (!visible || !repoId) {
      loading.value = false
      return
    }
    loading.value = true
    try {
      const next = await git.getReflog(repoId)
      if (seq !== loadSeq || !props.visible || repoStore.activeRepoId !== repoId) return
      entries.value = next
    } catch (e) {
      if (seq !== loadSeq || !props.visible || repoStore.activeRepoId !== repoId) return
      error.value = String(e)
    } finally {
      if (seq === loadSeq) loading.value = false
    }
  },
  { immediate: true },
)

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function copyOid(oid: string) {
  await copyText(oid, {
    successMessage: t('reflog.copySuccess'),
    failureMessage: t('reflog.copyFailed'),
  })
}
</script>

<template>
  <Modal :visible="visible" :title="title" width="680px" @close="emit('close')">
    <div class="reflog-body">
      <div v-if="loading" class="reflog-hint">{{ t('reflog.loading') }}</div>
      <div v-else-if="error" class="reflog-hint reflog-error">{{ error }}</div>
      <div v-else-if="entries.length === 0" class="reflog-hint">{{ t('reflog.empty') }}</div>
      <table v-else class="reflog-table">
        <thead>
          <tr>
            <th>{{ t('reflog.columnHash') }}</th>
            <th>{{ t('reflog.columnTime') }}</th>
            <th>{{ t('reflog.columnOperation') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(entry, i) in entries" :key="i">
            <td class="col-oid">
              <button
                type="button"
                class="oid"
                :title="t('reflog.copyTitle', { oid: entry.oid })"
                @click="copyOid(entry.oid)"
              >
                {{ entry.short_oid }}
              </button>
            </td>
            <td class="col-time">{{ formatTime(entry.time) }}</td>
            <td class="col-msg">{{ entry.message }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <template #footer>
      <button class="btn btn-secondary" @click="emit('close')">{{ t('reflog.close') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.reflog-body {
  min-height: 120px;
  max-height: 520px;
  overflow-y: auto;
}

.reflog-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  color: var(--text-muted);
  font-size: var(--font-base);
}

.reflog-error {
  color: var(--accent-red);
}

.reflog-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-md);
}

.reflog-table th {
  text-align: left;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
  font-weight: 500;
  position: sticky;
  top: 0;
  background: var(--bg-surface);
}

.reflog-table td {
  padding: 5px 10px;
  border-bottom: 1px solid #1e1e1e;
  color: var(--text-secondary);
  vertical-align: top;
}

.reflog-table tr:hover td {
  background: var(--bg-overlay);
}

.col-oid {
  width: 68px;
  white-space: nowrap;
}

.col-time {
  width: 120px;
  white-space: nowrap;
  color: var(--text-muted);
}

.col-msg {
  word-break: break-all;
}

.oid {
  padding: 0;
  border: 0;
  background: none;
  font-family: var(--code-font-family, 'SF Mono', 'Fira Code', monospace);
  font-size: inherit;
  color: var(--accent-blue);
  cursor: pointer;
  user-select: text;
}

.oid:hover,
.oid:focus-visible {
  text-decoration: underline;
}

</style>
