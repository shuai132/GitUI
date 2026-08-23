<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ContextMenu from '@/components/common/ContextMenu.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import { useRemoteActionMenu, type PullMode, type PushMode } from '@/composables/toolbar/useRemoteActionMenu'
import { useToolbarGitActions } from '@/composables/toolbar/useToolbarGitActions'

const { t } = useI18n()

const fetchBtnRef = ref<HTMLButtonElement | null>(null)
const remoteActions = useRemoteActionMenu()
const toolbarActions = useToolbarGitActions({
  fetchBtnRef,
  pickRemote: remoteActions.pickRemote,
})

const {
  remoteMenu,
  onRemoteMenuSelect,
  onRemoteMenuClose,
  pullModeMenu,
  pullModeMenuItems,
  pullChevronRect,
  onPullChevronClick,
  closePullModeMenu,
  pushModeMenu,
  pushModeMenuItems,
  pushChevronRect,
  onPushChevronClick,
  closePushModeMenu,
} = remoteActions

const {
  stashStore,
  busy,
  hasRepo,
  canRemoteOp,
  isPublishingBranch,
  canStash,
  canStashPop,
  pullWithChangesVisible,
  pendingPullChangeCount,
  pullWithChangesLoading,
  forcePushVisible,
  forcePushTarget,
  forcePushLoading,
  stashPopConfirmVisible,
  stashPopTarget,
  stashPopLoading,
  canUndoLastCommit,
  undoingCommit,
  withShortcut,
  showAddRepoMenu,
  onPull,
  doPull,
  confirmPullWithStash,
  cancelPullWithStash,
  onPush,
  doPush,
  confirmForcePush,
  cancelForcePush,
  onStash,
  onPop,
  confirmStashPop,
  cancelStashPop,
  onFetch,
  onRefreshRepository,
  onOpenSystemTerminal,
  onUndoLastCommit,
} = toolbarActions

function onPullModeSelect(action: string) {
  closePullModeMenu()
  if (action === 'manage_default_remote') {
    remoteActions.pickRemote(pullChevronRect.value ?? undefined, false, {
      forceMenu: true,
      resolveSelection: false,
    })
    return
  }
  doPull(action as PullMode, pullChevronRect.value ?? undefined)
}

function onPushModeSelect(action: string) {
  closePushModeMenu()
  if (action === 'manage_default_remote') {
    remoteActions.pickRemote(pushChevronRect.value ?? undefined, false, {
      forceMenu: true,
      resolveSelection: false,
    })
    return
  }
  doPush(action as PushMode, pushChevronRect.value ?? undefined)
}
</script>

<template>
  <div class="toolbar-actions">
    <button
      class="btn-tool"
      :title="t('repo.menu.title')"
      data-menu-anchor
      @click="showAddRepoMenu($event)"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span>Open</span>
    </button>

    <div class="toolbar-sep" />

    <!-- Undo the commit just created in this window -->
    <button
      v-if="canUndoLastCommit"
      class="btn-tool btn-tool--undo"
      :title="t('toolbar.title.undoCommit')"
      :disabled="undoingCommit"
      @click="onUndoLastCommit"
    >
      <span v-if="undoingCommit" class="spinner" />
      <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 14 4 9l5-5"/>
        <path d="M4 9h10a6 6 0 0 1 6 6v1"/>
      </svg>
      <span>{{ t('toolbar.opLabels.undoCommit') }}</span>
    </button>

    <!-- Pull -->
    <div class="btn-tool-group">
      <button
        class="btn-tool btn-tool--main"
        :title="t('toolbar.title.pull')"
        :disabled="!canRemoteOp || busy.pull"
        @click="onPull($event)"
      >
        <span v-if="busy.pull" class="spinner" />
        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="3" x2="12" y2="15"/>
          <polyline points="6 9 12 15 18 9"/>
          <line x1="6" y1="21" x2="18" y2="21"/>
        </svg>
        <span>Pull</span>
      </button>
      <button
        class="btn-tool btn-tool--chevron"
        :title="t('toolbar.title.pullModeSelect')"
        data-menu-anchor
        :disabled="!canRemoteOp || busy.pull"
        @click="onPullChevronClick($event)"
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
    </div>

    <!-- Push -->
    <div class="btn-tool-group">
      <button
        class="btn-tool btn-tool--main"
        :title="isPublishingBranch ? t('toolbar.title.publishBranch') : t('toolbar.title.push')"
        :disabled="!canRemoteOp || busy.push"
        @click="onPush($event)"
      >
        <span v-if="busy.push" class="spinner" />
        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="21" x2="12" y2="9"/>
          <polyline points="18 15 12 9 6 15"/>
          <line x1="6" y1="3" x2="18" y2="3"/>
        </svg>
        <span>{{ isPublishingBranch ? t('toolbar.opLabels.publishBranch') : 'Push' }}</span>
      </button>
      <button
        class="btn-tool btn-tool--chevron"
        :title="t('toolbar.title.pushModeSelect')"
        data-menu-anchor
        :disabled="!canRemoteOp || busy.push"
        @click="onPushChevronClick($event)"
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
    </div>

    <!-- Stash -->
    <button
      class="btn-tool"
      :title="canStash ? t('toolbar.title.stash') : t('toolbar.title.stashEmpty')"
      :disabled="!canStash || busy.stash"
      @click="onStash"
    >
      <span v-if="busy.stash" class="spinner" />
      <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
        <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
      </svg>
      <span>Stash</span>
    </button>

    <!-- Pop -->
    <button
      class="btn-tool"
      :title="canStashPop ? t('toolbar.title.popWithCount', { count: stashStore.entries.length }) : t('toolbar.title.popEmpty')"
      :disabled="!canStashPop || busy.pop"
      @click="onPop"
    >
      <span v-if="busy.pop" class="spinner" />
      <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
        <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
        <line x1="12" y1="15" x2="12" y2="5"/>
        <polyline points="9 8 12 5 15 8"/>
      </svg>
      <span>Pop</span>
    </button>

    <!-- Fetch -->
    <button
      ref="fetchBtnRef"
      class="btn-tool"
      :title="withShortcut(t('toolbar.title.fetch'), 'fetchAll')"
      :disabled="!hasRepo || busy.fetch"
      @click="onFetch($event)"
    >
      <span v-if="busy.fetch" class="spinner" />
      <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
      </svg>
      <span>Fetch</span>
    </button>

    <!-- Terminal -->
    <button
      class="btn-tool"
      :title="t('toolbar.title.terminalSystem')"
      :disabled="!hasRepo"
      @click="onOpenSystemTerminal"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="4 17 10 11 4 5"/>
        <line x1="12" y1="19" x2="20" y2="19"/>
      </svg>
      <span>Terminal</span>
    </button>

    <!-- Refresh -->
    <button
      class="btn-tool"
      :title="withShortcut(t('toolbar.title.refreshRepository'), 'refresh')"
      :disabled="!hasRepo || busy.refresh"
      @click="onRefreshRepository"
    >
      <span v-if="busy.refresh" class="spinner" />
      <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"/>
        <polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.86-3.36L23 10"/>
        <path d="M20.49 15a9 9 0 0 1-14.86 3.36L1 14"/>
      </svg>
      <span>Refresh</span>
    </button>

    <ContextMenu
      :visible="remoteMenu.visible"
      :x="remoteMenu.x"
      :y="remoteMenu.y"
      :items="remoteMenu.items"
      @close="onRemoteMenuClose"
      @select="onRemoteMenuSelect"
    />

    <ContextMenu
      :visible="pullModeMenu.visible"
      :x="pullModeMenu.x"
      :y="pullModeMenu.y"
      :items="pullModeMenuItems"
      @close="pullModeMenu.visible = false"
      @select="onPullModeSelect"
    />

    <ContextMenu
      :visible="pushModeMenu.visible"
      :x="pushModeMenu.x"
      :y="pushModeMenu.y"
      :items="pushModeMenuItems"
      @close="pushModeMenu.visible = false"
      @select="onPushModeSelect"
    />

    <ConfirmDialog
      :visible="pullWithChangesVisible"
      :title="t('toolbar.pullWithChanges.title')"
      :message="t('toolbar.pullWithChanges.message', { count: pendingPullChangeCount })"
      :confirm-label="t('toolbar.pullWithChanges.confirm')"
      :loading-label="t('toolbar.pullWithChanges.running')"
      :loading="pullWithChangesLoading"
      @confirm="confirmPullWithStash"
      @cancel="cancelPullWithStash"
    />

    <ConfirmDialog
      :visible="forcePushVisible"
      :title="t('toolbar.forcePushConfirm.title')"
      :message="t('toolbar.forcePushConfirm.message', { target: forcePushTarget })"
      :confirm-label="t('toolbar.forcePushConfirm.confirm')"
      :loading-label="t('toolbar.forcePushConfirm.running')"
      :loading="forcePushLoading"
      danger
      @confirm="confirmForcePush"
      @cancel="cancelForcePush"
    />

    <ConfirmDialog
      :visible="stashPopConfirmVisible"
      :title="t('toolbar.stashPopConfirm.title')"
      :message="t('toolbar.stashPopConfirm.message', {
        count: stashPopTarget?.changeCount ?? 0,
        index: stashPopTarget?.index ?? 0,
        message: stashPopTarget?.message ?? '',
      })"
      :confirm-label="t('toolbar.stashPopConfirm.confirm')"
      :loading-label="t('toolbar.stashPopConfirm.running')"
      :loading="stashPopLoading"
      @confirm="confirmStashPop"
      @cancel="cancelStashPop"
    />
  </div>
</template>

<style scoped>
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-sep {
  width: 1px;
  height: 22px;
  background: var(--border);
  flex-shrink: 0;
}

.btn-tool {
  background: none;
  border: 1px solid var(--border);
  cursor: pointer;
  color: var(--text-secondary);
  padding: 2px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-sm);
  font-family: inherit;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.btn-tool:hover:not(:disabled) {
  background: var(--bg-overlay);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.btn-tool--undo {
  border-color: color-mix(in srgb, var(--accent-orange) 50%, var(--border));
  color: var(--accent-orange);
}

.btn-tool:disabled {
  cursor: not-allowed;
}

.btn-tool:disabled:not(:has(.spinner)) {
  opacity: 0.4;
}

.btn-tool-group {
  display: flex;
  align-items: stretch;
}

.btn-tool-group .btn-tool--main {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: none;
}

.btn-tool-group .btn-tool--chevron {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  padding: 0 3px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.spinner {
  display: inline-block;
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--accent-blue);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
