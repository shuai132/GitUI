<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/stores/ui'

import ToolbarGitActions from '@/components/toolbar/ToolbarGitActions.vue'
import ToolbarRightControls from '@/components/toolbar/ToolbarRightControls.vue'
import ToolbarToast from '@/components/toolbar/ToolbarToast.vue'

import ReflogDialog from '@/components/common/ReflogDialog.vue'
import ErrorHistoryDialog from '@/components/common/ErrorHistoryDialog.vue'
import Modal from '@/components/common/Modal.vue'
import SettingsModal from '@/components/settings/SettingsModal.vue'
import AboutInfo from '@/components/common/AboutInfo.vue'

const appWindow = getCurrentWindow()
const { t } = useI18n()
const uiStore = useUiStore()

const showReflogDialog = ref(false)
const showErrorHistoryDialog = ref(false)
const showSettingsDialog = ref(false)
const showAboutDialog = ref(false)

// 响应来自全局快捷键的「打开设置」信号
watch(() => uiStore.openSettingsSignal, () => {
  showSettingsDialog.value = true
})

onMounted(() => {
  // 监听系统菜单栏的"关于"菜单
  listen('show-about', () => {
    showAboutDialog.value = true
  })
})

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

// ── 顶部工具栏作为窗口拖动区域 ─────────────────────────────────────
function handleDragStart(e: MouseEvent) {
  if (e.button !== 0) return
  if ((e.target as HTMLElement).closest('button, input, a, select, textarea')) return
  appWindow.startDragging()
}

async function handleDblClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, input, a, select, textarea')) return
  if (await appWindow.isMaximized()) await appWindow.unmaximize()
  else await appWindow.maximize()
}
</script>

<template>
  <div
    class="toolbar"
    :class="{ 'toolbar--mac': isMac }"
    data-tauri-drag-region
    @mousedown="handleDragStart"
    @dblclick="handleDblClick"
  >
    <ToolbarGitActions />

    <div class="toolbar-spacer" data-tauri-drag-region />

    <ToolbarToast />

    <ToolbarRightControls
      @show-reflog="showReflogDialog = true"
      @show-error-history="showErrorHistoryDialog = true"
      @show-settings="showSettingsDialog = true"
      @show-about="showAboutDialog = true"
    />

    <ReflogDialog
      :visible="showReflogDialog"
      @close="showReflogDialog = false"
    />

    <ErrorHistoryDialog
      :visible="showErrorHistoryDialog"
      @close="showErrorHistoryDialog = false"
    />

    <SettingsModal
      :visible="showSettingsDialog"
      @close="showSettingsDialog = false"
    />

    <Modal
      :visible="showAboutDialog"
      :title="t('common.aboutTitle')"
      width="fit-content"
      @close="showAboutDialog = false"
    >
      <AboutInfo />
    </Modal>
  </div>
</template>

<style scoped>
.toolbar {
  height: 38px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  gap: 8px;
  flex-shrink: 0;
  position: relative;
}

/* macOS traffic lights 让出 78px 空间 */
.toolbar--mac {
  padding-left: 78px;
}

.toolbar-spacer {
  flex: 1;
  align-self: stretch;
  min-width: 0;
}
</style>
