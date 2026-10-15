<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'
import AppSelect from '@/components/common/AppSelect.vue'
import { useHistoryStore } from '@/stores/history'
import { useRepoStore } from '@/stores/repos'
import { useWorkspaceStore } from '@/stores/workspace'
import type { BranchInfo, CommitInfo } from '@/types/git'
import type { HistoryResetMode } from '@/composables/history/historyActionConfirmation'

const props = defineProps<{ visible: boolean; commit: CommitInfo | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const historyStore = useHistoryStore()
const repoStore = useRepoStore()
const workspaceStore = useWorkspaceStore()
const repoId = ref<string | null>(null)
const commit = ref<CommitInfo | null>(null)
const branches = ref<BranchInfo[]>([])
const expectedHead = ref<string | null>(null)
const expectedHeadRef = ref('HEAD')
const branchName = ref<string | null>(null)
const mode = ref<HistoryResetMode>('mixed')
const submitting = ref(false)
const error = ref<string | null>(null)
const selectedBranch = computed(() => branches.value.find(branch => branch.name === branchName.value))
const branchOptions = computed(() => branches.value.map(branch => ({
  value: branch.name,
  label: `${branch.name} · ${branch.commit_oid?.slice(0, 7) ?? ''}`,
})))
const modes: HistoryResetMode[] = ['soft', 'mixed', 'hard']
const modeOptions = computed(() => modes.map(value => ({
  value,
  label: t(`history.contextMenu.reset${value[0].toUpperCase()}${value.slice(1)}`),
})))
const canSubmit = computed(() => !!commit.value && !!selectedBranch.value?.commit_oid && !submitting.value)

watch(() => props.visible, visible => {
  if (!visible) return
  repoId.value = repoStore.activeRepoId
  commit.value = props.commit ? { ...props.commit } : null
  branches.value = historyStore.branches
    .filter(branch => !branch.is_remote && !!branch.commit_oid)
    .map(branch => ({ ...branch }))
  expectedHead.value = workspaceStore.status?.head_commit ?? null
  expectedHeadRef.value = workspaceStore.status?.head_ref ?? 'HEAD'
  branchName.value = null
  mode.value = 'mixed'
  submitting.value = false
  error.value = null
}, { immediate: true })

function close() {
  if (!submitting.value) emit('close')
}

async function submit() {
  if (!canSubmit.value) return
  const openedRepoId = repoId.value
  const target = commit.value
  const branch = selectedBranch.value
  if (!openedRepoId || !target || !branch?.commit_oid) return
  if (repoStore.activeRepoId !== openedRepoId) {
    error.value = t('branch.formContextChanged')
    return
  }
  submitting.value = true
  error.value = null
  try {
    await historyStore.switchAndResetBranch(
      openedRepoId, branch.name, target.oid, mode.value,
      expectedHead.value, expectedHeadRef.value, branch.commit_oid,
    )
    emit('close')
  } catch (err: unknown) {
    error.value = String(err)
  } finally {
    if (repoStore.activeRepoId === openedRepoId) await workspaceStore.refresh(openedRepoId)
    submitting.value = false
  }
}
</script>

<template>
  <Modal
    :visible="visible"
    :title="t('history.dialog.switchResetBranch.title')"
    width="min(520px, calc(100vw - 32px))"
    @close="close"
  >
    <p class="hint">{{ t('history.dialog.switchResetBranch.body') }}</p>
    <p v-if="commit" class="target"><code>{{ commit.short_oid }}</code> {{ commit.summary }}</p>
    <div class="field">
      <label for="reset-local-branch">{{ t('history.dialog.switchResetBranch.branch') }}</label>
      <AppSelect
        id="reset-local-branch"
        v-model="branchName"
        :options="branchOptions"
        :aria-label="t('history.dialog.switchResetBranch.branch')"
        :disabled="submitting"
        searchable
      />
    </div>
    <div class="field">
      <label for="reset-branch-mode">{{ t('history.dialog.switchResetBranch.mode') }}</label>
      <AppSelect
        id="reset-branch-mode"
        v-model="mode"
        :options="modeOptions"
        :aria-label="t('history.dialog.switchResetBranch.mode')"
        :disabled="submitting"
      />
    </div>
    <p class="hint">{{ t('history.dialog.switchResetBranch.cleanRequired') }}</p>
    <p v-if="mode === 'hard'" class="warning">{{ t('history.dialog.switchResetBranch.hardWarning') }}</p>
    <p v-if="!branches.length" class="hint">{{ t('history.dialog.switchResetBranch.empty') }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template #footer>
      <button class="btn btn-secondary" :disabled="submitting" @click="close">{{ t('common.cancel') }}</button>
      <button
        class="btn"
        :class="mode === 'hard' ? 'btn-danger' : 'btn-primary'"
        :disabled="!canSubmit"
        @click="submit"
      >{{ t(submitting ? 'history.dialog.switchResetBranch.running' : 'history.dialog.switchResetBranch.confirm') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.hint { color: var(--text-secondary); font-size: var(--font-md); line-height: 1.6; }
.target { padding: 8px 10px; background: var(--bg-overlay); border-radius: 5px; overflow-wrap: anywhere; }
.target code { color: var(--accent-blue); margin-right: 6px; }
.field { display: grid; grid-template-columns: 90px minmax(0, 1fr); align-items: center; gap: 10px; margin: 12px 0; }
.field label { color: var(--text-secondary); font-size: var(--font-md); }
.warning, .error { color: var(--accent-red); font-size: var(--font-md); line-height: 1.6; }
</style>
