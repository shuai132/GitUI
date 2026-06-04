import { defineComponent, nextTick, type PropType } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ToolbarRightControls from './ToolbarRightControls.vue'
import type { ContextMenuItem } from '@/components/common/ContextMenu.vue'

interface MockUiStore {
  openSearchSignal: number
  historySearchQuery: string
  layoutPreset: 'custom' | 'vertical' | 'horizontal'
  showRemoteBranches: boolean
  showChangeStatsColumn: boolean
  diffHighlightEnabled: boolean
  showUnreachableCommits: boolean
  showStashCommits: boolean
  debugPanelVisible: boolean
  getHistoryBranchScope: ReturnType<typeof vi.fn>
  toggleShowRemoteBranches: ReturnType<typeof vi.fn>
  toggleShowChangeStatsColumn: ReturnType<typeof vi.fn>
  toggleDiffHighlight: ReturnType<typeof vi.fn>
  toggleShowUnreachable: ReturnType<typeof vi.fn>
  toggleShowStashes: ReturnType<typeof vi.fn>
  toggleHistoryBranchScopeForRepo: ReturnType<typeof vi.fn>
  toggleDebugPanel: ReturnType<typeof vi.fn>
  requestDiscardAll: ReturnType<typeof vi.fn>
  toggleHistoryLayout: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => {
  const uiStore: MockUiStore = {
    openSearchSignal: 0,
    historySearchQuery: '',
    layoutPreset: 'custom',
    showRemoteBranches: true,
    showChangeStatsColumn: false,
    diffHighlightEnabled: true,
    showUnreachableCommits: true,
    showStashCommits: true,
    debugPanelVisible: false,
    getHistoryBranchScope: vi.fn(() => 'all'),
    toggleShowRemoteBranches: vi.fn(),
    toggleShowChangeStatsColumn: vi.fn(),
    toggleDiffHighlight: vi.fn(),
    toggleShowUnreachable: vi.fn(),
    toggleShowStashes: vi.fn(),
    toggleHistoryBranchScopeForRepo: vi.fn(),
    toggleDebugPanel: vi.fn(),
    requestDiscardAll: vi.fn(),
    toggleHistoryLayout: vi.fn(),
  }

  uiStore.toggleShowChangeStatsColumn.mockImplementation(() => {
    uiStore.showChangeStatsColumn = !uiStore.showChangeStatsColumn
  })

  return {
    repoStore: {
      activeRepoId: 'repo-a' as string | null,
      activeRepo: vi.fn(() => ({ id: 'repo-a', path: '/repos/a' })),
    },
    uiStore,
    errorsStore: { entries: [] },
    repoOpsStore: { getBusy: vi.fn(() => ({ gc: false })) },
    terminalStore: {
      activeRepoVisible: false,
      toggleActiveRepoVisible: vi.fn(),
    },
    settingsStore: {
      resolvedTheme: 'dark' as 'light' | 'dark',
      themeMode: 'auto' as 'auto' | 'light' | 'dark',
    },
    pluginsStore: {
      loaded: true,
      toolbarCommands: [],
      executing: null,
      load: vi.fn(),
      execute: vi.fn(),
    },
    workspaceStore: { refresh: vi.fn() },
    historyStore: { loadLog: vi.fn(), loadBranches: vi.fn() },
    shortcutsStore: { bindings: {} },
    git: { runGc: vi.fn() },
    showToast: vi.fn(),
  }
})

vi.mock('@/stores/repos', () => ({
  useRepoStore: () => mocks.repoStore,
}))

vi.mock('@/stores/ui', () => ({
  useUiStore: () => mocks.uiStore,
}))

vi.mock('@/stores/errors', () => ({
  useErrorsStore: () => mocks.errorsStore,
}))

vi.mock('@/stores/repoOps', () => ({
  useRepoOpsStore: () => mocks.repoOpsStore,
}))

vi.mock('@/stores/terminal', () => ({
  useTerminalStore: () => mocks.terminalStore,
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => mocks.settingsStore,
}))

vi.mock('@/stores/plugins', () => ({
  usePluginsStore: () => mocks.pluginsStore,
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspaceStore: () => mocks.workspaceStore,
}))

vi.mock('@/stores/history', () => ({
  useHistoryStore: () => mocks.historyStore,
}))

vi.mock('@/stores/shortcuts', () => ({
  useShortcutsStore: () => mocks.shortcutsStore,
  bindingToLabel: () => '',
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => mocks.git,
}))

vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('@/composables/useBlurOnOutsidePointerDown', () => ({
  useBlurOnOutsidePointerDown: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'toolbar.actionsMenu.showChangeStatsColumn': '显示变更列',
        'toolbar.title.actions': '更多操作',
      }
      return labels[key] ?? key
    },
  }),
}))

const ContextMenuStub = defineComponent({
  name: 'ContextMenu',
  props: {
    visible: { type: Boolean, required: true },
    items: { type: Array as PropType<ContextMenuItem[]>, required: true },
  },
  emits: ['select', 'close'],
  template: `
    <div v-if="visible" data-test="actions-menu">
      <button
        v-for="item in items.filter((entry) => !entry.separator)"
        :key="item.action || item.label"
        type="button"
        :disabled="item.disabled"
        @click="$emit('select', item.action)"
      >
        {{ item.label }}
      </button>
    </div>
  `,
})

describe('ToolbarRightControls', () => {
  beforeEach(() => {
    mocks.repoStore.activeRepoId = 'repo-a'
    mocks.uiStore.showChangeStatsColumn = false
    vi.clearAllMocks()
  })

  it('toggles the changes column from the actions menu', async () => {
    const wrapper = mount(ToolbarRightControls, {
      global: {
        stubs: {
          ContextMenu: ContextMenuStub,
        },
      },
    })

    await wrapper.find('[data-menu-anchor]').trigger('click')
    await nextTick()

    const changeColumnItem = wrapper
      .findAll('[data-test="actions-menu"] button')
      .find((button) => button.text().includes('显示变更列'))

    expect(changeColumnItem).toBeDefined()

    await changeColumnItem!.trigger('click')

    expect(mocks.uiStore.toggleShowChangeStatsColumn).toHaveBeenCalledTimes(1)
    expect(mocks.uiStore.showChangeStatsColumn).toBe(true)

    wrapper.unmount()
  })
})
