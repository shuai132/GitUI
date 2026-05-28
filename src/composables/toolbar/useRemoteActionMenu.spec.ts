import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemoteActionMenu } from './useRemoteActionMenu'

const mocks = vi.hoisted(() => {
  const repoStore = {
    activeRepoId: 'repo-a' as string | null,
    activeRepo: vi.fn(() => ({ path: '/repos/a' })),
  }
  const uiStore = {
    getDefaultRemote: vi.fn(() => null as string | null),
    clearDefaultRemoteForRepo: vi.fn(),
    setDefaultRemoteForRepo: vi.fn(),
  }

  return {
    listRemotes: vi.fn(),
    showToast: vi.fn(),
    repoStore,
    uiStore,
  }
})

vi.mock('@/stores/repos', () => ({
  useRepoStore: () => mocks.repoStore,
}))

vi.mock('@/stores/ui', () => ({
  useUiStore: () => mocks.uiStore,
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({
    listRemotes: mocks.listRemotes,
  }),
}))

vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showToast: mocks.showToast,
  }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

function makeRect(left: number, bottom: number): DOMRect {
  return {
    x: left,
    y: bottom - 10,
    width: 10,
    height: 10,
    top: bottom - 10,
    right: left + 10,
    bottom,
    left,
    toJSON: () => ({}),
  } as DOMRect
}

function makeChevronClick(rect: DOMRect): MouseEvent {
  return {
    stopPropagation: vi.fn(),
    currentTarget: {
      getBoundingClientRect: () => rect,
    },
  } as unknown as MouseEvent
}

describe('useRemoteActionMenu', () => {
  beforeEach(() => {
    mocks.repoStore.activeRepoId = 'repo-a'
    mocks.repoStore.activeRepo.mockReturnValue({ path: '/repos/a' })
    mocks.uiStore.getDefaultRemote.mockReturnValue(null)
    mocks.listRemotes.mockResolvedValue([
      { name: 'origin', url: 'https://example.com/repo.git' },
      { name: 'upstream', url: 'https://example.com/upstream.git' },
    ])
    vi.clearAllMocks()
  })

  it('keeps pull and push mode menus mutually exclusive', () => {
    const menu = useRemoteActionMenu()

    menu.onPullChevronClick(makeChevronClick(makeRect(20, 40)))

    expect(menu.pullModeMenu.visible).toBe(true)
    expect(menu.pushModeMenu.visible).toBe(false)

    menu.onPushChevronClick(makeChevronClick(makeRect(60, 40)))

    expect(menu.pullModeMenu.visible).toBe(false)
    expect(menu.pushModeMenu.visible).toBe(true)
  })

  it('closes an open remote menu before opening a mode menu', async () => {
    const menu = useRemoteActionMenu()
    const pendingRemote = menu.pickRemote(makeRect(20, 40), false, { forceMenu: true })
    await Promise.resolve()

    expect(menu.remoteMenu.visible).toBe(true)

    menu.onPushChevronClick(makeChevronClick(makeRect(60, 40)))

    expect(menu.remoteMenu.visible).toBe(false)
    expect(menu.pushModeMenu.visible).toBe(true)
    await expect(pendingRemote).resolves.toBeNull()
  })
})
