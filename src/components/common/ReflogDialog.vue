<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from '@/stores/repos'
import type { ReflogEntry } from '@/types/git'

const { t } = useI18n()

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const git = useGitCommands()
const repoStore = useRepoStore()

const entries = ref<ReflogEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.visible,
  async (v) => {
    if (!v) return
    const id = repoStore.activeRepoId
    if (!id) return
    loading.value = true
    error.value = null
    try {
      entries.value = await git.getReflog(id)
    } catch (e) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  },
)

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function copyOid(oid: string) {
  navigator.clipboard.writeText(oid)
}
</script>

<template>
  <Modal :visible="visible" :title="t('reflog.title')" width="680px" @close="emit('close')">
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
              <span class="oid" :title="entry.oid" @click="copyOid(entry.oid)">
                {{ entry.short_oid }}
              </span>
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
  font-family: var(--code-font-family, 'SF Mono', 'Fira Code', monospace);
  color: var(--accent-blue);
  cursor: pointer;
  user-select: text;
}

.oid:hover {
  text-decoration: underline;
}

</style>
