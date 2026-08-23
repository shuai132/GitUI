import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UpdateSection from './UpdateSection.vue'

const mocks = vi.hoisted(() => ({
  settings: { updateStrategy: 'auto' as 'auto' | 'manual' },
  getBuildInfo: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/stores/settings', () => ({ useSettingsStore: () => mocks.settings }))
vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({ getBuildInfo: mocks.getBuildInfo }),
}))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ message: vi.fn() }))
vi.mock('@/utils/format', () => ({ formatTime: (value: number) => String(value) }))
vi.mock('@/utils/updateCheck', () => ({
  LAST_UPDATE_CHECK_EVENT: 'update-check',
  isNetworkUpdateCheckError: () => false,
  readLastUpdateCheckTime: () => null,
  recordLastUpdateCheckTime: () => 1,
}))

describe('UpdateSection strategy controls', () => {
  beforeEach(() => {
    mocks.settings.updateStrategy = 'auto'
    mocks.getBuildInfo.mockReset().mockResolvedValue({ version: '1.0.0', git_hash: null })
  })

  it('uses focusable buttons with exposed selection state', async () => {
    const wrapper = shallowMount(UpdateSection)
    await flushPromises()
    const strategies = wrapper.findAll('.strategy-item')

    expect(strategies).toHaveLength(2)
    expect(strategies.every((item) => item.element.tagName === 'BUTTON')).toBe(true)
    expect(strategies[0].attributes('aria-pressed')).toBe('true')
    expect(strategies[1].attributes('aria-pressed')).toBe('false')

    await strategies[1].trigger('click')
    expect(mocks.settings.updateStrategy).toBe('manual')
  })
})
