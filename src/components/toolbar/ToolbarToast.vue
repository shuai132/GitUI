<script setup lang="ts">
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useErrorsStore } from '@/stores/errors'
import { useGlobalToast } from '@/composables/useGlobalToast'

const { t } = useI18n()
const errorsStore = useErrorsStore()
const { toast, showToast } = useGlobalToast()

// IPC 错误自动弹 toast
// errorsStore 由 useGitCommands.call() 统一 push。watch latestId 即可。
const OP_LABELS: Record<string, () => string> = {
  pull_branch: () => t('toolbar.opLabels.pull'),
  push_branch: () => t('toolbar.opLabels.push'),
  fetch_remote: () => t('toolbar.opLabels.fetch'),
  stash_push: () => t('toolbar.opLabels.stash'),
  stash_pop: () => t('toolbar.opLabels.stashPop'),
  run_gc: () => t('toolbar.opLabels.gc'),
  open_repo: () => t('toolbar.opLabels.openRepo'),
  checkout_commit: () => t('toolbar.opLabels.checkoutCommit'),
  cherry_pick_commit: () => t('toolbar.opLabels.cherryPick'),
  revert_commit: () => t('toolbar.opLabels.revert'),
  reset_to_commit: () => t('toolbar.opLabels.reset'),
  create_branch: () => t('toolbar.opLabels.createBranch'),
  switch_branch: () => t('toolbar.opLabels.switchBranch'),
  delete_branch: () => t('toolbar.opLabels.deleteBranch'),
  checkout_remote_branch: () => t('toolbar.opLabels.checkoutRemoteBranch'),
  create_commit: () => t('toolbar.opLabels.commit'),
  amend_commit: () => t('toolbar.opLabels.amend'),
  create_tag: () => t('toolbar.opLabels.createTag'),
  discard_all_changes: () => t('toolbar.opLabels.discardAll'),
  discard_file: () => t('toolbar.opLabels.discardFile'),
  open_terminal: () => t('toolbar.opLabels.openTerminal'),
  init_submodule: () => t('toolbar.opLabels.initSubmodule'),
  update_submodule: () => t('toolbar.opLabels.updateSubmodule'),
  set_submodule_url: () => t('toolbar.opLabels.setSubmoduleUrl'),
  deinit_submodule: () => t('toolbar.opLabels.deinitSubmodule'),
}

watch(
  () => errorsStore.latestId,
  (id) => {
    if (!id) return
    const entry = errorsStore.entries[0]
    if (!entry) return
    const label = OP_LABELS[entry.op]?.()
    const msg = label ? t('toolbar.opFailed', { label, message: entry.friendly }) : entry.friendly
    showToast(entry.level, msg)
  },
)
</script>

<template>
  <Transition name="toast">
    <div v-if="toast" class="toast" :class="`toast--${toast.type}`">
      <div class="toast-accent" />
      <div class="toast-icon-wrap">
        <!-- success: checkmark -->
        <svg v-if="toast.type === 'success'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <!-- warning: triangle + exclamation -->
        <svg v-else-if="toast.type === 'warning'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <!-- error: X -->
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </div>
      <span class="toast-message">{{ toast.message }}</span>
      <div class="toast-progress" />
    </div>
  </Transition>
</template>

<style scoped>
.toast-enter-active {
  transition: opacity 0.28s ease, transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.toast-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(calc(100% + 24px));
}

.toast {
  position: fixed;
  top: 56px;
  right: 16px;
  width: 288px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-surface);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px;
  padding: 13px 14px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.3);
  z-index: 9999;
}

/* 左侧彩色竖条 */
.toast-accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: 10px 0 0 10px;
}

/* 图标圆圈 */
.toast-icon-wrap {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toast-message {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  word-break: break-word;
}

/* 底部倒计时进度条 */
.toast-progress {
  position: absolute;
  left: 4px;
  right: 0;
  bottom: 0;
  height: 2px;
  border-radius: 0 0 10px 0;
  transform-origin: left;
  animation: toast-progress-shrink 3s linear forwards;
}

@keyframes toast-progress-shrink {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}

/* 成功：绿色 */
.toast--success .toast-accent {
  background: var(--accent-green);
}
.toast--success .toast-icon-wrap {
  background: color-mix(in srgb, var(--accent-green) 18%, transparent);
  color: var(--accent-green);
}
.toast--success .toast-message {
  color: var(--text-primary);
}
.toast--success .toast-progress {
  background: var(--accent-green);
  opacity: 0.5;
}

/* 失败：红色 */
.toast--error .toast-accent {
  background: var(--accent-red);
}
.toast--error .toast-icon-wrap {
  background: color-mix(in srgb, var(--accent-red) 18%, transparent);
  color: var(--accent-red);
}
.toast--error .toast-message {
  color: var(--text-primary);
}
.toast--error .toast-progress {
  background: var(--accent-red);
  opacity: 0.5;
}

/* 警告：橙色（冲突等"需要用户介入"的中间状态） */
.toast--warning .toast-accent {
  background: var(--accent-orange);
}
.toast--warning .toast-icon-wrap {
  background: color-mix(in srgb, var(--accent-orange) 18%, transparent);
  color: var(--accent-orange);
}
.toast--warning .toast-message {
  color: var(--text-primary);
}
.toast--warning .toast-progress {
  background: var(--accent-orange);
  opacity: 0.5;
}
</style>
