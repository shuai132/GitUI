import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TerminalPanel from './TerminalPanel.vue'

const mocks = vi.hoisted(() => {
  const makeTab = (id: string, title: string) => ({
    id,
    title,
    sessionId: null,
    hasSelection: false,
    term: {
      options: {},
      element: null,
      cols: 80,
      rows: 24,
      focus: vi.fn(),
    },
    fit: { fit: vi.fn() },
  })
  const tabs = [makeTab('tab-1', 'Shell 1'), makeTab('tab-2', 'Shell 2')]
  return {
    tabs,
    ui: {
      terminalDock: 'bottom',
      terminalHeight: 240,
      terminalWidth: 400,
      toggleTerminalDock: vi.fn(),
      persistTerminalHeight: vi.fn(),
      persistTerminalWidth: vi.fn(),
    },
    repo: { activeRepoId: 'repo-a' as string | null },
    terminal: {
      repoTabs: new Map([['repo-a', tabs]]),
      activeRepoVisible: false,
      getTabsForRepo: vi.fn(() => tabs),
      getActiveTab: vi.fn(() => tabs[0]),
      setActiveTab: vi.fn(),
      setActiveRepoVisible: vi.fn(),
      closeTab: vi.fn(),
      createTerminal: vi.fn(),
      initEvents: vi.fn().mockResolvedValue(undefined),
    },
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/stores/ui', () => ({ useUiStore: () => mocks.ui }))
vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('@/stores/terminal', () => ({ useTerminalStore: () => mocks.terminal }))
vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({ terminalResize: vi.fn(), terminalWrite: vi.fn() }),
}))

describe('TerminalPanel tabs', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    mocks.ui.terminalDock = 'bottom'
    mocks.ui.terminalHeight = 240
    mocks.ui.terminalWidth = 400
    mocks.ui.persistTerminalHeight.mockReset()
    mocks.ui.persistTerminalWidth.mockReset()
    mocks.terminal.setActiveTab.mockReset()
    mocks.terminal.closeTab.mockReset()
  })

  it('supports horizontal tab semantics and keyboard switching', async () => {
    const wrapper = mount(TerminalPanel, {
      attachTo: document.body,
      global: { stubs: { ContextMenu: true } },
    })
    const tabList = wrapper.find('[role="tablist"]')
    const tabs = wrapper.findAll<HTMLButtonElement>('[role="tab"]')
    const closeButtons = wrapper.findAll<HTMLButtonElement>('.tab-close')

    expect(tabs).toHaveLength(2)
    expect(tabs[0]?.attributes('aria-selected')).toBe('true')
    expect(tabs[0]?.attributes('tabindex')).toBe('0')
    expect(tabs[1]?.attributes('tabindex')).toBe('-1')
    expect(closeButtons[0]?.attributes('aria-label')).toBe('terminal.closeTab: Shell 1')
    expect(closeButtons[1]?.attributes('tabindex')).toBe('-1')

    tabs[0]?.element.focus()
    await tabs[0]?.trigger('keydown', { key: 'ArrowRight' })

    expect(mocks.terminal.setActiveTab).toHaveBeenCalledWith('repo-a', 'tab-2')
    expect(document.activeElement).toBe(tabs[1]?.element)
    expect(tabList.exists()).toBe(true)

    await tabs[1]?.trigger('keydown', { key: 'Home' })
    expect(mocks.terminal.setActiveTab).toHaveBeenLastCalledWith('repo-a', 'tab-1')
    expect(document.activeElement).toBe(tabs[0]?.element)

    expect(wrapper.find('.add-tab-btn').attributes('aria-label')).toBe('terminal.newTab')
    expect(wrapper.findAll('.term-btn')[0]?.attributes('aria-label')).toBe('terminal.dockRight')
    expect(wrapper.findAll('.term-btn')[1]?.attributes('aria-label')).toBe('terminal.close')
    wrapper.unmount()
  })

  it('resizes both terminal dock orientations from the keyboard', async () => {
    const wrapper = mount(TerminalPanel, {
      global: { stubs: { ContextMenu: true } },
    })
    const separator = wrapper.find<HTMLElement>('[role="separator"]')

    expect(separator.attributes('aria-label')).toBe('terminal.resize')
    expect(separator.attributes('aria-orientation')).toBe('horizontal')
    expect(separator.attributes('aria-valuenow')).toBe('240')
    expect(Number(separator.attributes('aria-valuemax'))).toBeGreaterThanOrEqual(240)

    await separator.trigger('keydown', { key: 'ArrowUp' })
    expect(mocks.ui.terminalHeight).toBe(260)
    expect(mocks.ui.persistTerminalHeight).toHaveBeenCalledOnce()
    wrapper.unmount()

    mocks.ui.terminalDock = 'right'
    const rightWrapper = mount(TerminalPanel, {
      global: { stubs: { ContextMenu: true } },
    })
    const rightSeparator = rightWrapper.find<HTMLElement>('[role="separator"]')

    expect(rightSeparator.attributes('aria-orientation')).toBe('vertical')
    await rightSeparator.trigger('keydown', { key: 'ArrowLeft' })
    expect(mocks.ui.terminalWidth).toBe(420)
    expect(mocks.ui.persistTerminalWidth).toHaveBeenCalledOnce()
    rightWrapper.unmount()
  })
})
