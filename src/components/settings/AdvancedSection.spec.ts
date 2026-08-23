import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdvancedSection from './AdvancedSection.vue'

const mocks = vi.hoisted(() => ({
  gitPrefs: {
    autoFetchInterval: 300,
    setAutoFetchInterval: vi.fn((secs: number) => {
      mocks.gitPrefs.autoFetchInterval = secs
    }),
  },
  setAutoFetchInterval: vi.fn(),
  showError: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      `${key} ${Object.values(params ?? {}).join(' ')}`.trim(),
  }),
}))
vi.mock('@/stores/gitPrefs', () => ({
  useGitPrefsStore: () => mocks.gitPrefs,
  FETCH_INTERVAL_OPTIONS: [
    { value: 0, labelKey: 'disabled' },
    { value: 300, labelKey: 'fiveMinutes' },
    { value: 600, labelKey: 'tenMinutes' },
  ],
}))
vi.mock('@/stores/ui', () => ({
  DEFAULT_ADVANCED_VIEW_PREFS: {
    diffLayoutMode: 'inline',
    diffGroupByHunk: false,
    diffHighlightEnabled: true,
    diffIgnoreWhitespace: false,
    showRemoteBranches: true,
    showChangeStatsColumn: false,
    showUnreachableCommits: false,
    showStashCommits: false,
    debugPanelVisible: false,
    detailFilesFirst: false,
  },
  useUiStore: () => ({
    diffLayoutMode: 'inline',
    diffGroupByHunk: false,
    diffHighlightEnabled: true,
    diffIgnoreWhitespace: false,
    showRemoteBranches: true,
    showChangeStatsColumn: false,
    showUnreachableCommits: false,
    showStashCommits: false,
    debugPanelVisible: false,
    detailFilesFirst: false,
    toggleDiffGroupByHunk: vi.fn(),
    toggleDiffHighlight: vi.fn(),
    toggleDiffIgnoreWhitespace: vi.fn(),
    toggleShowRemoteBranches: vi.fn(),
    toggleShowChangeStatsColumn: vi.fn(),
    toggleShowUnreachable: vi.fn(),
    toggleShowStashes: vi.fn(),
    toggleDebugPanel: vi.fn(),
    toggleDetailFilesFirst: vi.fn(),
    resetAdvancedViewPrefs: vi.fn(),
    setDiffLayoutMode: vi.fn(),
  }),
}))
vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({ setAutoFetchInterval: mocks.setAutoFetchInterval }),
}))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showActionError: (_error: unknown, fallback?: string) => mocks.showError(fallback),
  }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('AdvancedSection auto-fetch interval', () => {
  beforeEach(() => {
    mocks.gitPrefs.autoFetchInterval = 300
    mocks.gitPrefs.setAutoFetchInterval.mockClear()
    mocks.setAutoFetchInterval.mockReset().mockResolvedValue(undefined)
    mocks.showError.mockReset()
  })

  it('rolls back the preference and reports a backend update failure', async () => {
    mocks.setAutoFetchInterval.mockRejectedValue(new Error('service unavailable'))
    const wrapper = shallowMount(AdvancedSection)

    await wrapper.find('select').setValue('600')
    await flushPromises()

    expect(mocks.setAutoFetchInterval).toHaveBeenCalledWith(600)
    expect(mocks.gitPrefs.setAutoFetchInterval).toHaveBeenNthCalledWith(1, 600)
    expect(mocks.gitPrefs.setAutoFetchInterval).toHaveBeenNthCalledWith(2, 300)
    expect(mocks.gitPrefs.autoFetchInterval).toBe(300)
    expect(mocks.showError).toHaveBeenCalledWith(
      'settings.gitPrefs.fetchIntervalUpdateFailed Error: service unavailable',
    )
  })

  it('disables repeated changes while the backend update is pending', async () => {
    const update = deferred<void>()
    mocks.setAutoFetchInterval.mockReturnValueOnce(update.promise)
    const wrapper = shallowMount(AdvancedSection)

    void wrapper.find('select').setValue('600')
    await Promise.resolve()

    expect(wrapper.find('select').attributes('disabled')).toBeDefined()
    update.resolve()
    await flushPromises()
    expect(wrapper.find('select').attributes('disabled')).toBeUndefined()
  })
})
