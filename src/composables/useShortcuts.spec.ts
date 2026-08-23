import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useShortcuts } from './useShortcuts'
import { useShortcutsStore, type KeyBinding } from '@/stores/shortcuts'
import { useUiStore } from '@/stores/ui'

vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    async get() { return null }
    async set() {}
    async save() {}
  },
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({}),
}))

vi.mock('@/stores/history', () => ({
  useHistoryStore: () => ({
    selectedWip: false,
    jumpAdjacentCommit: vi.fn(),
    loadLog: vi.fn(),
    loadBranches: vi.fn(),
    selectCommit: vi.fn(),
  }),
}))

vi.mock('@/stores/repos', () => ({
  useRepoStore: () => ({ activeRepoId: null }),
}))

vi.mock('@/stores/terminal', () => ({
  useTerminalStore: () => ({ toggleActiveRepoVisible: vi.fn() }),
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspaceStore: () => ({
    commitDraft: '',
    status: null,
    commit: vi.fn(),
  }),
}))

vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({ showError: vi.fn() }),
}))

vi.mock('@/composables/useRepositoryRefresh', () => ({
  useRepositoryRefresh: () => ({ refreshActiveRepository: vi.fn() }),
}))

const Harness = defineComponent({
  setup() {
    useShortcuts()
    return () => null
  },
})

function dispatchBinding(binding: KeyBinding) {
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: binding.key,
    ctrlKey: binding.ctrl,
    metaKey: binding.meta,
    shiftKey: binding.shift,
    altKey: binding.alt,
    bubbles: true,
    cancelable: true,
  }))
}

describe('useShortcuts', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('dispatches the configurable quick repository switch shortcut', async () => {
    const shortcutStore = useShortcutsStore()
    const uiStore = useUiStore()
    shortcutStore.setBinding('openRepo', { key: 'k', alt: true })
    const wrapper = mount(Harness, { attachTo: document.body })

    dispatchBinding(shortcutStore.bindings.openRepo as KeyBinding)
    await nextTick()

    expect(uiStore.openRepoSearchSignal).toBe(1)
    wrapper.unmount()
  })
})
