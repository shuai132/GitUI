<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import Modal from '@/components/common/Modal.vue'
import { useRepoStore } from '@/stores/repos'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const repoStore = useRepoStore()

const url = ref('')
const parentDir = ref('')
const customName = ref('')
const depthStr = ref('')
const recurseSubmodules = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)
const urlInputEl = ref<HTMLInputElement | null>(null)

// ── 进度状态 ────────────────────────────────────────────────────────
// 后端通过 repo://operation-progress 推送，payload 形如
// { op: "clone", stage, progress, message? }
type ProgressPayload = {
  op: string
  stage: string
  progress: number
  message?: string
}
const progressStage = ref<string>('')
const progressPct = ref<number>(0)
const sidebandLines = ref<string[]>([])
let unlistenProgress: UnlistenFn | null = null

onMounted(async () => {
  unlistenProgress = await listen<ProgressPayload>(
    'repo://operation-progress',
    (event) => {
      const p = event.payload
      if (p.op !== 'clone') return
      if (p.stage === 'sideband') {
        if (p.message) {
          // 截断历史，避免内存膨胀
          sidebandLines.value = [...sidebandLines.value.slice(-9), p.message]
        }
        return
      }
      progressStage.value = p.stage
      progressPct.value = Math.max(0, Math.min(100, p.progress))
    },
  )
})

onUnmounted(() => {
  unlistenProgress?.()
})

// ── 推导本地目录名 ──────────────────────────────────────────────────
function inferDirName(u: string): string {
  const trimmed = u.trim().replace(/\/+$/, '')
  const last = trimmed.split(/[\/:]/).pop() || ''
  const stripped = last.endsWith('.git') ? last.slice(0, -4) : last
  return stripped || 'repo'
}

const inferredName = computed(() => inferDirName(url.value))
const finalName = computed(() => customName.value.trim() || inferredName.value)
const finalPath = computed(() => {
  if (!parentDir.value || !finalName.value) return ''
  // 跨平台简单拼接，反斜杠在 Windows 下也能识别
  const sep = parentDir.value.includes('\\') ? '\\' : '/'
  return parentDir.value.replace(/[\/\\]+$/, '') + sep + finalName.value
})

const nameInvalid = computed(() => /[\\/]/.test(customName.value))

const canSubmit = computed(() => {
  return (
    !!url.value.trim() &&
    !!parentDir.value &&
    !nameInvalid.value &&
    !submitting.value
  )
})

watch(
  () => props.visible,
  async (v) => {
    if (!v) return
    // 重置状态
    url.value = ''
    parentDir.value = ''
    customName.value = ''
    depthStr.value = ''
    recurseSubmodules.value = false
    submitting.value = false
    error.value = null
    progressStage.value = ''
    progressPct.value = 0
    sidebandLines.value = []
    await nextTick()
    urlInputEl.value?.focus()
  },
  { immediate: true },
)

async function onPickParentDir() {
  try {
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
    const selected = await openDialog({ directory: true })
    if (typeof selected === 'string') {
      parentDir.value = selected
    }
  } catch (e) {
    console.error(e)
  }
}

function parseDepth(): number | undefined {
  const s = depthStr.value.trim()
  if (!s) return undefined
  const n = Number.parseInt(s, 10)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

async function onSubmit() {
  if (!canSubmit.value) return
  // 字段级校验 → 集中错误展示
  const u = url.value.trim()
  if (!u) {
    error.value = t('repo.clone.errors.urlRequired')
    return
  }
  if (!parentDir.value) {
    error.value = t('repo.clone.errors.parentRequired')
    return
  }
  if (nameInvalid.value) {
    error.value = t('repo.clone.errors.nameInvalid')
    return
  }

  submitting.value = true
  error.value = null
  progressStage.value = ''
  progressPct.value = 0
  sidebandLines.value = []

  try {
    await repoStore.cloneRepo({
      url: u,
      parentDir: parentDir.value,
      name: customName.value.trim() || undefined,
      depth: parseDepth(),
      recurseSubmodules: recurseSubmodules.value,
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

const stageLabel = computed(() => {
  if (!progressStage.value) return t('repo.clone.progress.idle')
  switch (progressStage.value) {
    case 'receiving':
      return t('repo.clone.progress.receiving')
    case 'indexing':
      return t('repo.clone.progress.indexing')
    case 'checkout':
      return t('repo.clone.progress.checkout')
    case 'sideband':
      return t('repo.clone.progress.sideband')
    default:
      return progressStage.value
  }
})
</script>

<template>
  <Modal
    :visible="visible"
    :title="t('repo.clone.title')"
    width="540px"
    @close="onCancel"
  >
    <div class="form-row">
      <label class="form-label">{{ t('repo.clone.urlLabel') }}</label>
      <input
        ref="urlInputEl"
        v-model="url"
        class="form-control"
        type="text"
        :placeholder="t('repo.clone.urlPlaceholder')"
        spellcheck="false"
        autocomplete="off"
        :disabled="submitting"
        @keydown.enter="onSubmit"
      />
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('repo.clone.parentDirLabel') }}</label>
      <div class="path-picker">
        <input
          v-model="parentDir"
          class="form-control"
          type="text"
          :placeholder="t('repo.clone.parentDirPlaceholder')"
          spellcheck="false"
          :disabled="submitting"
        />
        <button
          type="button"
          class="btn btn-secondary btn-pick"
          :disabled="submitting"
          @click="onPickParentDir"
        >
          {{ t('repo.clone.chooseDir') }}
        </button>
      </div>
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('repo.clone.nameLabel') }}</label>
      <input
        v-model="customName"
        class="form-control"
        type="text"
        :placeholder="inferredName || t('repo.clone.namePlaceholder')"
        spellcheck="false"
        autocomplete="off"
        :disabled="submitting"
      />
    </div>

    <div class="form-row">
      <label class="form-label">{{ t('repo.clone.depthLabel') }}</label>
      <div class="depth-row">
        <input
          v-model="depthStr"
          class="form-control form-control--narrow"
          type="number"
          min="1"
          step="1"
          :placeholder="t('repo.clone.depthPlaceholder')"
          :disabled="submitting"
        />
        <span class="depth-hint">{{ t('repo.clone.depthHint') }}</span>
      </div>
    </div>

    <div class="form-row form-row--checkbox">
      <label class="checkbox-label">
        <input
          v-model="recurseSubmodules"
          type="checkbox"
          :disabled="submitting"
        />
        <span>{{ t('repo.clone.recurseSubmodules') }}</span>
      </label>
    </div>

    <div v-if="finalPath" class="final-path">
      <span class="final-path-label">{{ t('repo.clone.finalPathLabel') }}</span>
      <span class="final-path-value">{{ finalPath }}</span>
    </div>

    <div v-if="submitting" class="progress-area">
      <div class="progress-row">
        <span class="progress-stage">{{ stageLabel }}</span>
        <span class="progress-pct">{{ progressPct }}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-bar-fill" :style="{ width: progressPct + '%' }" />
      </div>
      <pre v-if="sidebandLines.length > 0" class="sideband">{{ sidebandLines.join('\n') }}</pre>
    </div>

    <div v-if="nameInvalid" class="form-error">
      {{ t('repo.clone.errors.nameInvalid') }}
    </div>
    <div v-if="error" class="form-error">{{ error }}</div>

    <template #footer>
      <button class="btn btn-secondary" :disabled="submitting" @click="onCancel">
        {{ t('common.cancel') }}
      </button>
      <button class="btn btn-primary" :disabled="!canSubmit" @click="onSubmit">
        {{ submitting ? t('repo.clone.submitting') : t('repo.clone.submit') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.form-row {
  display: grid;
  grid-template-columns: 110px 1fr;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.form-row--checkbox {
  align-items: center;
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
}

.form-control:focus {
  border-color: var(--accent-blue);
}

.form-control:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.form-control--narrow {
  width: 140px;
  flex-shrink: 0;
}

.path-picker {
  display: flex;
  gap: 8px;
}

.btn-pick {
  flex-shrink: 0;
  padding: 5px 12px;
  font-size: var(--font-md);
}

.depth-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.depth-hint {
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-md);
  color: var(--text-secondary);
  cursor: pointer;
  grid-column: 2;
}

.checkbox-label input[type='checkbox'] {
  cursor: pointer;
  accent-color: var(--accent-blue);
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

.progress-area {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--bg-overlay);
  border-radius: 4px;
}

.progress-row {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.progress-pct {
  font-family: var(--font-mono, monospace);
  color: var(--text-primary);
}

.progress-bar {
  height: 6px;
  background: var(--bg-primary);
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--accent-blue);
  transition: width 0.15s ease-out;
}

.sideband {
  margin: 8px 0 0;
  padding: 6px 8px;
  max-height: 100px;
  overflow-y: auto;
  background: var(--bg-primary);
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
  font-size: var(--font-xs);
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-all;
}

.form-error {
  color: var(--accent-red);
  font-size: var(--font-sm);
  margin-top: 6px;
  padding-left: 120px;
  word-break: break-all;
}

</style>
