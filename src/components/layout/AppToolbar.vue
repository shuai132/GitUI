<script setup lang="ts">
import { useRepoStore } from '@/stores/repos'

const repoStore = useRepoStore()

async function openFolder() {
  try {
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
    const selected = await openDialog({ directory: true })
    if (selected) {
      await repoStore.openRepo(selected as string)
    }
  } catch (e) {
    console.error(e)
  }
}

// ── 顶部工具栏作为窗口拖动区域 ─────────────────────────────────────
async function handleDragStart(e: MouseEvent) {
  // 只响应左键
  if (e.button !== 0) return
  // 点击在按钮等可交互元素上时不触发拖动
  if ((e.target as HTMLElement).closest('button, input, a, select, textarea')) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().startDragging()
}

async function handleDblClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, input, a, select, textarea')) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  if (await win.isMaximized()) await win.unmaximize()
  else await win.maximize()
}
</script>

<template>
  <div class="toolbar" @mousedown="handleDragStart" @dblclick="handleDblClick">
    <div class="toolbar-brand">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2">
        <line x1="6" y1="3" x2="6" y2="15"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 0 1-9 9"/>
      </svg>
      <span class="brand-name">GitUI</span>
    </div>

    <div class="toolbar-actions">
      <button class="btn-icon" title="打开仓库" @click="openFolder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span>打开</span>
      </button>
    </div>
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
  gap: 12px;
  flex-shrink: 0;
  /* macOS traffic lights 让出 78px 空间 */
  padding-left: 78px;
}

.toolbar-brand {
  display: flex;
  align-items: center;
  gap: 6px;
}

.brand-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.02em;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-icon {
  background: none;
  border: 1px solid var(--border);
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px 8px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}

.btn-icon:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}
</style>
