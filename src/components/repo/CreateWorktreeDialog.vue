<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'
import { useGitCommands } from '@/composables/useGitCommands'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { useRepoStore } from '@/stores/repos'
import type { BranchInfo, RepoMeta } from '@/types/git'
import { isInvalidDirectoryLeafName } from '@/utils/pathName'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  repo: RepoMeta | null
}>()

const emit = defineEmits<{
  close: []
}>()

interface WorktreeStartPoint {
  key: string
  label: string
  name: string
  is_remote: boolean
  is_head: boolean
  commit_oid: string
}

type ResolvedBranch = BranchInfo & { commit_oid: string }

const git = useGitCommands()
const { showActionError } = useGlobalToast()
const repoStore = useRepoStore()

const parentDir = ref('')
const dirName = ref('')
const branchName = ref('')
const startPointKey = ref('')
const startPoints = ref<WorktreeStartPoint[]>([])
const loadingBranches = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)
const branchInputEl = ref<HTMLInputElement | null>(null)
let branchLoadSeq = 0

const selectedStartPoint = computed(() =>
  startPoints.value.find((item) => item.key === startPointKey.value) ?? null,
)

const inferredDirName = computed(() => {
  const branch = branchName.value.trim()
  const source = props.repo?.name ?? 'worktree'
  const slug = branch
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `${source}-worktree`
})

const finalDirName = computed(() => dirName.value.trim() || inferredDirName.value)
const dirNameInvalid = computed(() => isInvalidDirectoryLeafName(dirName.value))

const finalPath = computed(() => {
  if (!parentDir.value || !finalDirName.value) return ''
  const sep = parentDir.value.includes('\\') ? '\\' : '/'
  return parentDir.value.replace(/[\/\\]+$/, '') + sep + finalDirName.value
})

const canSubmit = computed(() => {
  return (
    !!props.repo &&
    !!parentDir.value &&
    !!branchName.value.trim() &&
    !!selectedStartPoint.value &&
    !dirNameInvalid.value &&
    !loadingBranches.value &&
    !submitting.value
  )
})

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return
    resetForm()
    const repo = props.repo
    if (repo) {
      parentDir.value = dirname(repo.path)
      await loadStartPoints(repo)
    }
    await nextTick()
    branchInputEl.value?.focus()
  },
  { immediate: true },
)

watch(
  () => props.repo?.id,
  async () => {
    if (!props.visible) return
    resetForm()
    const repo = props.repo
    if (repo) {
      parentDir.value = dirname(repo.path)
      await loadStartPoints(repo)
    }
  },
)

function resetForm() {
  branchLoadSeq += 1
  parentDir.value = ''
  dirName.value = ''
  branchName.value = ''
  startPointKey.value = ''
  startPoints.value = []
  loadingBranches.value = false
  submitting.value = false
  error.value = null
}

function dirname(path: string): string {
  const normalized = path.replace(/[\/\\]+$/, '')
  const slash = normalized.lastIndexOf('/')
  const backslash = normalized.lastIndexOf('\\')
  const idx = Math.max(slash, backslash)
  return idx > 0 ? normalized.slice(0, idx) : ''
}

function toStartPoint(branch: ResolvedBranch): WorktreeStartPoint {
  const baseLabel = branch.is_remote
    ? t('repo.worktree.remoteStartPoint', { name: branch.name })
    : branch.name
  return {
    key: `${branch.is_remote ? 'remote' : 'local'}:${branch.name}`,
    label: `${baseLabel} · ${branch.commit_oid.slice(0, 7)}`,
    name: branch.name,
    is_remote: branch.is_remote,
    is_head: branch.is_head,
    commit_oid: branch.commit_oid,
  }
}

async function loadStartPoints(repo: RepoMeta) {
  const seq = ++branchLoadSeq
  loadingBranches.value = true
  error.value = null
  try {
    const branches = await git.listBranches(repo.id)
    if (seq !== branchLoadSeq) return
    const resolved = branches.filter(
      (branch): branch is ResolvedBranch => typeof branch.commit_oid === 'string',
    )
    const local = resolved.filter((branch) => !branch.is_remote).map(toStartPoint)
    const remote = resolved.filter((branch) => branch.is_remote).map(toStartPoint)
    startPoints.value = [...local, ...remote]
    const head = startPoints.value.find((branch) => branch.is_head)
    startPointKey.value = (head ?? startPoints.value[0])?.key ?? ''
  } catch (e: unknown) {
    if (seq !== branchLoadSeq) return
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (seq === branchLoadSeq) {
      loadingBranches.value = false
    }
  }
}

async function onPickParentDir() {
  try {
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
    const selected = await openDialog({ directory: true })
    if (typeof selected === 'string') {
      parentDir.value = selected
    }
  } catch (error: unknown) {
    showActionError(error, t('common.directoryPickerFailed'))
  }
}

async function onSubmit() {
  if (!canSubmit.value) return
  const repo = props.repo
  const startPoint = selectedStartPoint.value
  if (!repo) {
    error.value = t('repo.worktree.errors.sourceRequired')
    return
  }
  if (!parentDir.value) {
    error.value = t('repo.worktree.errors.parentRequired')
    return
  }
  if (!branchName.value.trim()) {
    error.value = t('repo.worktree.errors.branchRequired')
    return
  }
  if (!startPoint) {
    error.value = t('repo.worktree.errors.startPointRequired')
    return
  }
  if (dirNameInvalid.value) {
    error.value = t('repo.worktree.errors.dirNameInvalid')
    return
  }

  submitting.value = true
  error.value = null
  try {
    await repoStore.createWorktree(repo.id, {
      path: finalPath.value,
      branchName: branchName.value.trim(),
      startPoint: startPoint.name,
      startPointIsRemote: startPoint.is_remote,
      expectedStartOid: startPoint.commit_oid,
    })
    emit('close')
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    submitting.value = false
  }
}

function onCancel() {
  if (submitting.value) return
  emit('close')
}
</script>

<template>
  <Modal
    :visible="visible"
    :title="t('repo.worktree.title')"
    width="520px"
    @close="onCancel"
  >
    <div v-if="repo" class="source-row">
      <span class="source-label">{{ t('repo.worktree.sourceLabel') }}</span>
      <span class="source-name">{{ repo.name }}</span>
      <span class="source-path">{{ repo.path }}</span>
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('repo.worktree.startPointLabel') }}</label>
      <select
        v-model="startPointKey"
        class="form-control"
        :disabled="loadingBranches || submitting || startPoints.length === 0"
      >
        <option
          v-for="item in startPoints"
          :key="item.key"
          :value="item.key"
        >
          {{ item.label }}
        </option>
      </select>
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('repo.worktree.branchLabel') }}</label>
      <input
        ref="branchInputEl"
        v-model="branchName"
        class="form-control"
        type="text"
        :placeholder="t('repo.worktree.branchPlaceholder')"
        spellcheck="false"
        autocomplete="off"
        :disabled="submitting"
        @keydown.enter="onSubmit"
      />
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('repo.worktree.parentDirLabel') }}</label>
      <div class="path-picker">
        <input
          v-model="parentDir"
          class="form-control"
          type="text"
          :placeholder="t('repo.worktree.parentDirPlaceholder')"
          spellcheck="false"
          :disabled="submitting"
        />
        <button
          type="button"
          class="btn btn-secondary btn-pick"
          :disabled="submitting"
          @click="onPickParentDir"
        >
          {{ t('repo.worktree.chooseDir') }}
        </button>
      </div>
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('repo.worktree.dirNameLabel') }}</label>
      <input
        v-model="dirName"
        class="form-control"
        type="text"
        :placeholder="inferredDirName"
        spellcheck="false"
        autocomplete="off"
        :disabled="submitting"
        @keydown.enter="onSubmit"
      />
    </div>

    <div v-if="finalPath" class="final-path">
      <span class="final-path-label">{{ t('repo.worktree.finalPathLabel') }}</span>
      <span class="final-path-value">{{ finalPath }}</span>
    </div>

    <div v-if="loadingBranches" class="hint">{{ t('repo.worktree.loadingBranches') }}</div>
    <div v-else class="hint">{{ t('repo.worktree.hint') }}</div>

    <div v-if="dirNameInvalid" class="form-error">
      {{ t('repo.worktree.errors.dirNameInvalid') }}
    </div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <template #footer>
      <button class="btn btn-secondary" :disabled="submitting" @click="onCancel">
        {{ t('common.cancel') }}
      </button>
      <button class="btn btn-primary" :disabled="!canSubmit" @click="onSubmit">
        {{ submitting ? t('repo.worktree.submitting') : t('repo.worktree.submit') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.source-row {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 4px 10px;
  margin-bottom: 14px;
  padding: 8px 10px;
  background: var(--bg-overlay);
  border-radius: 5px;
  font-size: var(--font-sm);
}

.source-label {
  color: var(--text-secondary);
  text-align: right;
}

.source-name {
  color: var(--text-primary);
  font-weight: 500;
}

.source-path {
  grid-column: 2;
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  overflow-wrap: anywhere;
}

.form-row {
  display: grid;
  grid-template-columns: 96px 1fr;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.form-label {
  font-size: var(--font-md);
  color: var(--text-secondary);
  text-align: right;
}

.form-control {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-md);
  padding: 5px 8px;
  outline: none;
  width: 100%;
  min-width: 0;
}

.form-control:focus {
  border-color: var(--accent-blue);
}

.form-control:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.path-picker {
  display: flex;
  gap: 8px;
  min-width: 0;
}

.btn-pick {
  flex-shrink: 0;
  padding: 5px 12px;
  font-size: var(--font-md);
}

.final-path {
  margin: 8px 0 4px;
  padding: 6px 10px;
  background: var(--bg-overlay);
  border-radius: 4px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  word-break: break-all;
}

.final-path-label {
  margin-right: 6px;
}

.final-path-value {
  color: var(--text-primary);
  font-family: var(--font-mono, monospace);
}

.hint {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.form-error {
  color: var(--accent-red);
  font-size: var(--font-sm);
  margin-top: 6px;
  padding-left: 106px;
  word-break: break-all;
}
</style>
