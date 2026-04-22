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
import { useGitCommands } from '@/composables/useGitCommands'

export function useShortcuts() {
  const shortcutsStore = useShortcutsStore()
  const uiStore = useUiStore()
  const historyStore = useHistoryStore()
  const repoStore = useRepoStore()
  const git = useGitCommands()

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

    if (matchesBinding(e, b.refresh)) {
      e.preventDefault()
      const id = repoStore.activeRepoId
      if (id) {
        historyStore.loadLog()
        historyStore.loadBranches()
      }
      return
    }

    if (matchesBinding(e, b.openSettings)) {
      e.preventDefault()
      uiStore.requestOpenSettings()
      return
    }

    if (matchesBinding(e, b.search)) {
      e.preventDefault()
      const activeEl = document.activeElement
      if (activeEl && activeEl.closest('.diff-view')) {
        uiStore.requestOpenDiffSearch()
      } else {
        uiStore.requestOpenSearch()
      }
      return
    }

    if (matchesBinding(e, b.toggleTerminal)) {
      e.preventDefault()
      uiStore.toggleTerminalVisible()
      return
    }

    if (matchesBinding(e, b.fetchAll)) {
      e.preventDefault()
      const id = repoStore.activeRepoId
      if (id) {
        try {
          const remotes = await git.listRemotes(id)
          for (const remote of remotes) {
            await git.fetchRemote(id, remote)
          }
          historyStore.loadLog()
          historyStore.loadBranches()
        } catch {
          // errors handled by errorsStore via useGitCommands
        }
      }
      return
    }

    if (matchesBinding(e, b.toggleDiffLayout)) {
      e.preventDefault()
      uiStore.toggleHistoryLayout()
      return
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
