<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Modal from '@/components/common/Modal.vue'
import type { BranchSwitchMode } from '@/composables/useBranchSwitch'

const { t } = useI18n()

defineProps<{
  visible: boolean
  sourceBranch: string
  targetBranch: string
  changeCount: number
  loading: boolean
  activeMode: BranchSwitchMode | null
  changesStashed: boolean
  changesDiscarded: boolean
  error: string | null
}>()

const emit = defineEmits<{
  confirm: [mode: BranchSwitchMode]
  cancel: []
}>()
</script>

<template>
  <Modal
    :visible="visible"
    :title="t('sidebar.branch.switchDialog.title')"
    width="600px"
    @close="emit('cancel')"
  >
    <div class="switch-body">
      <p>{{ t('sidebar.branch.switchDialog.intro', { count: changeCount }) }}</p>
      <dl>
        <div>
          <dt>{{ t('sidebar.branch.switchDialog.source') }}</dt>
          <dd>{{ sourceBranch }}</dd>
        </div>
        <div>
          <dt>{{ t('sidebar.branch.switchDialog.target') }}</dt>
          <dd>{{ targetBranch }}</dd>
        </div>
      </dl>
      <p v-if="!changesStashed && !changesDiscarded" class="hint">
        {{ t('sidebar.branch.switchDialog.choiceHint') }}
      </p>
      <p v-else-if="changesStashed" class="protected-safe">
        {{ t('sidebar.branch.switchDialog.stashSafe') }}
      </p>
      <p v-else class="protected-safe">
        {{ t('sidebar.branch.switchDialog.discardSafe') }}
      </p>
      <p v-if="error" class="switch-error">{{ error }}</p>
    </div>

    <template #footer>
      <button class="btn btn-secondary" :disabled="loading" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </button>
      <button
        v-if="!changesStashed && !changesDiscarded"
        class="btn btn-danger"
        :disabled="loading"
        @click="emit('confirm', 'discard')"
      >
        {{ loading && activeMode === 'discard'
          ? t('sidebar.branch.switchDialog.discarding')
          : t('sidebar.branch.switchDialog.discardAndSwitch') }}
      </button>
      <button
        v-if="!changesStashed && !changesDiscarded"
        class="btn btn-secondary"
        :disabled="loading"
        @click="emit('confirm', 'stash')"
      >
        {{ loading && activeMode === 'stash'
          ? t('sidebar.branch.switchDialog.stashing')
          : t('sidebar.branch.switchDialog.stashAndSwitch') }}
      </button>
      <button class="btn btn-primary" :disabled="loading" @click="emit('confirm', 'carry')">
        {{ loading && activeMode === 'carry'
          ? t('sidebar.branch.switchDialog.switching')
          : changesStashed || changesDiscarded
            ? t('sidebar.branch.switchDialog.retry')
            : t('sidebar.branch.switchDialog.carryAndSwitch') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.switch-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--text-secondary);
  font-size: var(--font-md);
  line-height: 1.55;
}

.switch-body p,
.switch-body dl {
  margin: 0;
}

.switch-body dl {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.switch-body dl > div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
}

.switch-body dt {
  color: var(--text-muted);
}

.switch-body dd {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--code-font-family);
  overflow-wrap: anywhere;
}

.hint {
  color: var(--text-muted);
}

.protected-safe {
  color: var(--accent-green);
}

.switch-error {
  padding: 10px 12px;
  border-radius: 6px;
  color: var(--accent-red);
  background: color-mix(in srgb, var(--accent-red) 10%, transparent);
}
</style>
