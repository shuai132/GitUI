import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useShortcuts } from './useShortcuts'
import { useShortcutsStore, type KeyBinding } from '@/stores/shortcuts'
import { useUiStore } from '@/stores/ui'
import type { FileEntry, WorkspaceStatus } from '@/types/git'

const shortcutMocks = vi.hoisted(() => ({
  history: {
    selectedWip: false,
    showDetail: false,
    jumpAdjacentCommit: vi.fn(),
    loadLog: vi.fn(async () => {}),
    loadBranches: vi.fn(async () => {}),
    selectCommit: vi.fn(),
  },
  repo: { activeRepoId: null as string | null },
  terminal: { toggleActiveRepoVisible: vi.fn(async () => {}) },
  workspace: {
    commitDraft: '',
    status: null as WorkspaceStatus | null,
    wipSelectedPath: null as string | null,
    stageFile: vi.fn(async () => {}),
    unstageFile: vi.fn(async () => {}),
    stageAll: vi.fn(async () => {}),
    unstageAll: vi.fn(async () => {}),
    commit: vi.fn(async () => undefined),
  },
  diff: {
    currentPath: null as string | null,
    currentStaged: false,
    loadFileDiff: vi.fn(async () => {}),
  },
  showError: vi.fn(),
}))

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
  useHistoryStore: () => shortcutMocks.history,
}))

vi.mock('@/stores/repos', () => ({
  useRepoStore: () => shortcutMocks.repo,
}))

vi.mock('@/stores/terminal', () => ({
  useTerminalStore: () => shortcutMocks.terminal,
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspaceStore: () => shortcutMocks.workspace,
}))

vi.mock('@/stores/diff', () => ({
  useDiffStore: () => shortcutMocks.diff,
}))

vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({ showError: shortcutMocks.showError }),
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

function file(path: string, staged: boolean): FileEntry {
  return {
    path,
    staged,
    status: 'modified',
    additions: 1,
    deletions: 0,
  }
}

function workspaceStatus(files: {
  staged?: FileEntry[]
  unstaged?: FileEntry[]
  untracked?: FileEntry[]
}): WorkspaceStatus {
  return {
    staged: files.staged ?? [],
    unstaged: files.unstaged ?? [],
    untracked: files.untracked ?? [],
    is_detached: false,
    repo_state: { kind: 'clean' },
  }
}

function dispatchBinding(binding: KeyBinding, repeat = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: binding.key,
    ctrlKey: binding.ctrl,
    metaKey: binding.meta,
    shiftKey: binding.shift,
    altKey: binding.alt,
    repeat,
    bubbles: true,
    cancelable: true,
  })
  document.dispatchEvent(event)
  return event
}

describe('useShortcuts', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    shortcutMocks.history.selectedWip = false
    shortcutMocks.history.showDetail = false
    shortcutMocks.repo.activeRepoId = null
    shortcutMocks.workspace.commitDraft = ''
    shortcutMocks.workspace.status = null
    shortcutMocks.workspace.wipSelectedPath = null
    shortcutMocks.diff.currentPath = null
    shortcutMocks.diff.currentStaged = false
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

  it('stages the selected unstaged file and follows it to the staged diff', async () => {
    const selected = file('src/selected.ts', false)
    shortcutMocks.history.selectedWip = true
    shortcutMocks.repo.activeRepoId = 'repo-1'
    shortcutMocks.workspace.status = workspaceStatus({ unstaged: [selected] })
    shortcutMocks.workspace.wipSelectedPath = selected.path
    shortcutMocks.diff.currentPath = selected.path
    shortcutMocks.diff.currentStaged = false
    const shortcutStore = useShortcutsStore()
    const wrapper = mount(Harness, { attachTo: document.body })

    const event = dispatchBinding(shortcutStore.bindings.stageCurrentFile as KeyBinding)

    await vi.waitFor(() => {
      expect(shortcutMocks.workspace.stageFile).toHaveBeenCalledWith(selected.path)
      expect(shortcutMocks.diff.loadFileDiff).toHaveBeenCalledWith(selected.path, true)
    })
    expect(event.defaultPrevented).toBe(true)
    wrapper.unmount()
  })

  it('does not run the opposite or repeated current-file action', async () => {
    const selected = file('src/selected.ts', false)
    shortcutMocks.history.selectedWip = true
    shortcutMocks.repo.activeRepoId = 'repo-1'
    shortcutMocks.workspace.status = workspaceStatus({ unstaged: [selected] })
    shortcutMocks.workspace.wipSelectedPath = selected.path
    shortcutMocks.diff.currentPath = selected.path
    const shortcutStore = useShortcutsStore()
    const wrapper = mount(Harness, { attachTo: document.body })

    dispatchBinding(shortcutStore.bindings.unstageCurrentFile as KeyBinding)
    dispatchBinding(shortcutStore.bindings.stageCurrentFile as KeyBinding, true)
    await nextTick()

    expect(shortcutMocks.workspace.unstageFile).not.toHaveBeenCalled()
    expect(shortcutMocks.workspace.stageFile).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('stages all files and preserves the selected path on the target side', async () => {
    const selected = file('src/selected.ts', false)
    shortcutMocks.history.selectedWip = true
    shortcutMocks.repo.activeRepoId = 'repo-1'
    shortcutMocks.workspace.status = workspaceStatus({ unstaged: [selected] })
    shortcutMocks.workspace.wipSelectedPath = selected.path
    shortcutMocks.diff.currentPath = selected.path
    const shortcutStore = useShortcutsStore()
    const wrapper = mount(Harness, { attachTo: document.body })

    dispatchBinding(shortcutStore.bindings.stageAllFiles as KeyBinding)

    await vi.waitFor(() => {
      expect(shortcutMocks.workspace.stageAll).toHaveBeenCalledOnce()
      expect(shortcutMocks.diff.loadFileDiff).toHaveBeenCalledWith(selected.path, true)
    })
    wrapper.unmount()
  })

  it('requests commit-message focus only from the WIP view', async () => {
    const shortcutStore = useShortcutsStore()
    const uiStore = useUiStore()
    const wrapper = mount(Harness, { attachTo: document.body })

    dispatchBinding(shortcutStore.bindings.focusCommitMessage as KeyBinding)
    expect(uiStore.focusCommitMessageSignal).toBe(0)

    shortcutMocks.history.selectedWip = true
    dispatchBinding(shortcutStore.bindings.focusCommitMessage as KeyBinding)
    await nextTick()

    expect(uiStore.focusCommitMessageSignal).toBe(1)
    expect(shortcutMocks.history.showDetail).toBe(true)
    wrapper.unmount()
  })
})
