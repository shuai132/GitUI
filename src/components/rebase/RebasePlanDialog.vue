<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'
import { useMergeRebaseStore } from '@/stores/mergeRebase'
import type { RebaseActionKind, RebaseTodoItem } from '@/types/git'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  /** 上游（目标 commit 或分支名），`upstream..HEAD` 列为 rebase todo */
  upstream: string
  onto: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const mr = useMergeRebaseStore()

const todo = ref<RebaseTodoItem[]>([])
const loading = ref(false)
const submitting = ref(false)
const autoStash = ref(false)
const errorMsg = ref<string | null>(null)
const editingIdx = ref<number | null>(null)
const editingMessage = ref('')

const actions: Array<{ value: RebaseActionKind; label: string }> = [
  { value: 'pick', label: 'pick' },
  { value: 'reword', label: 'reword' },
  { value: 'squash', label: 'squash' },
  { value: 'fixup', label: 'fixup' },
  { value: 'drop', label: 'drop' },
]

async function loadPlan() {
  loading.value = true
  errorMsg.value = null
  try {
    const items = await mr.planRebase(props.upstream, props.onto)
    todo.value = items
  } catch (e) {
    errorMsg.value = String(e)
    todo.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    submitting.value = false
    autoStash.value = false
    errorMsg.value = null
    editingIdx.value = null
    loadPlan()
  },
  { immediate: true },
)

function onActionChange(idx: number, action: RebaseActionKind) {
  todo.value[idx].action = action
  if (action !== 'reword' && action !== 'squash') {
    todo.value[idx].new_message = undefined
  }
}

function openMessageEditor(idx: number) {
  editingIdx.value = idx
  editingMessage.value = todo.value[idx].new_message ?? todo.value[idx].subject
}

function saveMessage() {
  if (editingIdx.value == null) return
  todo.value[editingIdx.value].new_message = editingMessage.value
  editingIdx.value = null
}

function move(idx: number, delta: number) {
  const target = idx + delta
  if (target < 0 || target >= todo.value.length) return
  const arr = todo.value.slice()
  const [it] = arr.splice(idx, 1)
  arr.splice(target, 0, it)
  todo.value = arr
}

const canSubmit = computed(() =>
  !submitting.value && !loading.value && todo.value.some(t => t.action !== 'drop'),
)

async function onSubmit() {
  submitting.value = true
  errorMsg.value = null
  try {
    await mr.startRebase(props.upstream, props.onto, todo.value, autoStash.value)
    emit('close')
  } catch (e) {
    errorMsg.value = String(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Modal
    :visible="visible"
    :title="t('rebase.dialog.title')"
    width="720px"
    @close="emit('close')"
  >
    <div class="hint">
      {{ t('rebase.dialog.hint', { upstream }) }}
    </div>

    <div v-if="loading" class="loading">{{ t('rebase.dialog.loading') }}</div>

    <div v-else-if="todo.length === 0" class="empty">
      {{ t('rebase.dialog.empty') }}
    </div>

    <ol v-else class="todo-list">
      <li v-for="(item, idx) in todo" :key="item.oid" class="todo-item" :class="item.action">
        <div class="reorder">
          <button
            class="btn-tiny"
            :disabled="idx === 0"
            :title="t('rebase.dialog.moveUp')"
            @click="move(idx, -1)"
          >↑</button>
          <button
            class="btn-tiny"
            :disabled="idx === todo.length - 1"
            :title="t('rebase.dialog.moveDown')"
            @click="move(idx, 1)"
          >↓</button>
        </div>
        <select
          class="action-select"
          :value="item.action"
          @change="(e) => onActionChange(idx, ((e.target as HTMLSelectElement).value) as RebaseActionKind)"
        >
          <option v-for="a in actions" :key="a.value" :value="a.value">
            {{ a.label }}
          </option>
        </select>
        <code class="oid">{{ item.short_oid }}</code>
        <div class="subject">{{ item.subject }}</div>
        <button
          v-if="item.action === 'reword' || item.action === 'squash'"
          class="btn-edit"
          @click="openMessageEditor(idx)"
        >
          {{ item.new_message ? t('rebase.dialog.editMessageFilled') : t('rebase.dialog.editMessage') }}
        </button>
      </li>
    </ol>

    <div class="autostash">
      <label class="checkbox">
        <input v-model="autoStash" type="checkbox" />
        <span>{{ t('rebase.dialog.autoStash') }}</span>
      </label>
    </div>

    <div v-if="errorMsg" class="error">{{ errorMsg }}</div>

    <Modal
      :visible="editingIdx !== null"
      :title="t('rebase.dialog.editMessageTitle')"
      width="500px"
      @close="editingIdx = null"
    >
      <textarea v-model="editingMessage" class="message-area" rows="6" />
      <template #footer>
        <button class="btn btn-secondary" @click="editingIdx = null">
          {{ t('common.cancel') }}
        </button>
        <button class="btn btn-primary" @click="saveMessage">
          {{ t('rebase.dialog.saveMessage') }}
        </button>
      </template>
    </Modal>

    <template #footer>
      <button class="btn btn-secondary" @click="emit('close')">
        {{ t('common.cancel') }}
      </button>
      <button class="btn btn-primary" :disabled="!canSubmit" @click="onSubmit">
        {{ submitting ? t('rebase.dialog.submitting') : t('rebase.dialog.submit') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.hint {
  font-size: var(--font-md);
  color: var(--text-secondary);
  margin-bottom: 10px;
  padding: 6px 10px;
  background: var(--bg-overlay);
  border-radius: 4px;
}

.loading,
.empty {
  text-align: center;
  color: var(--text-muted, var(--text-secondary));
  padding: 24px;
}

.todo-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 420px;
  overflow-y: auto;
}

.todo-item {
  display: grid;
  grid-template-columns: auto 100px 72px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  font-size: var(--font-md);
}

.todo-item.drop {
  opacity: 0.45;
  text-decoration: line-through;
}

.todo-item.squash,
.todo-item.fixup {
  background: var(--bg-overlay);
}

.todo-item.reword {
  background: color-mix(in oklab, var(--accent-blue) 8%, transparent);
}

.reorder {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.btn-tiny {
  width: 22px;
  height: 16px;
  font-size: var(--font-sm);
  line-height: 1;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-primary);
  cursor: pointer;
}

.btn-tiny:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.action-select {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: var(--font-md);
  padding: 3px 5px;
}

.oid {
  font-family: var(--font-mono, monospace);
  color: var(--accent-blue);
}

.subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-edit {
  font-size: var(--font-sm);
  padding: 2px 8px;
  background: var(--bg-overlay);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
}

.error {
  margin-top: 8px;
  color: var(--accent-red);
  font-size: var(--font-sm);
}

.autostash {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-md);
  color: var(--text-secondary);
  cursor: pointer;
}

.checkbox input[type='checkbox'] {
  cursor: pointer;
  accent-color: var(--accent-blue);
}

.message-area {
  width: 100%;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: var(--font-mono, monospace);
  font-size: var(--font-md);
  padding: 6px 8px;
  outline: none;
  resize: vertical;
}

</style>
