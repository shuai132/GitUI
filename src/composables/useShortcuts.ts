/**
 * useShortcuts.ts — 全局键盘快捷键 handler
 *
 * 使用 document 的冒泡阶段监听（不是 window），
 * 这样录制模式的 document capture 监听可以用 stopImmediatePropagation
 * 彻底阻止本 handler 在录制期间误触发。
 *
 * 跳过规则：
 * 1. 聚焦元素是 input / textarea / select / contenteditable
 * 2. 当前有快捷键录制正在进行（页面上存在 .shortcut-key.recording 元素）
 */

import { onMounted, onUnmounted } from 'vue'
import { useShortcutsStore, matchesBinding } from '@/stores/shortcuts'
import { useUiStore } from '@/stores/ui'
import { useHistoryStore } from '@/stores/history'
import { useRepoStore } from '@/stores/repos'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGlobalToast } from '@/composables/useGlobalToast'

export function useShortcuts() {
  const shortcutsStore = useShortcutsStore()
  const uiStore = useUiStore()
  const historyStore = useHistoryStore()
  const repoStore = useRepoStore()
  const terminalStore = useTerminalStore()
  const workspaceStore = useWorkspaceStore()
  const { showError } = useGlobalToast()

  function shouldIgnore(): boolean {
    const el = document.activeElement
    if (!el) return false
    const tag = (el as HTMLElement).tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
    if ((el as HTMLElement).isContentEditable) return true
    // 快捷键录制期间不触发全局快捷键（document capture 会先拦截）
    if (document.querySelector('.shortcut-key.recording')) return true
    return false
  }

  async function onKeyDown(e: KeyboardEvent) {
    if (shouldIgnore()) return

    const b = shortcutsStore.bindings

    function consume() {
      e.preventDefault()
      e.stopPropagation()
    }

    if (matchesBinding(e, b.refresh)) {
      consume()
      const id = repoStore.activeRepoId
      if (id) {
        historyStore.loadLog()
        historyStore.loadBranches()
      }
      return
    }

    if (matchesBinding(e, b.openSettings)) {
      consume()
      uiStore.requestOpenSettings()
      return
    }

    if (matchesBinding(e, b.search)) {
      consume()
      const activeEl = document.activeElement
      if (activeEl && activeEl.closest('.diff-view')) {
        uiStore.requestOpenDiffSearch()
      } else {
        uiStore.requestOpenSearch()
      }
      return
    }

    if (matchesBinding(e, b.toggleTerminal)) {
      consume()
      terminalStore.toggleActiveRepoVisible().catch((err: unknown) => {
        showError(String(err))
      })
      return
    }

    if (matchesBinding(e, b.fetchAll)) {
      consume()
      uiStore.requestFetch('--all')
      return
    }

    if (matchesBinding(e, b.toggleDiffLayout)) {
      consume()
      uiStore.toggleHistoryLayout()
      return
    }

    if (matchesBinding(e, b.prevCommit)) {
      consume()
      historyStore.jumpAdjacentCommit(-1)
      return
    }

    if (matchesBinding(e, b.nextCommit)) {
      consume()
      historyStore.jumpAdjacentCommit(1)
      return
    }

    if (matchesBinding(e, b.commit)) {
      consume()
      if (e.repeat || !repoStore.activeRepoId || !historyStore.selectedWip) return

      const message = workspaceStore.commitDraft.trim()
      const stagedCount = workspaceStore.status?.staged.length ?? 0
      if (!message || stagedCount === 0) return

      try {
        const oid = await workspaceStore.commit(message)
        workspaceStore.commitDraft = ''
        await Promise.all([historyStore.loadLog(), historyStore.loadBranches()])
        if (oid) historyStore.selectCommit(oid)
      } catch (err) {
        showError(String(err))
      }
    }
  }

  onMounted(() => {
    // 使用 document 冒泡阶段，而非 window——
    // 这样录制的 document capture 监听可以用 stopImmediatePropagation 拦截本 handler
    document.addEventListener('keydown', onKeyDown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', onKeyDown)
  })
}
