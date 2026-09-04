import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UpdateSection from './UpdateSection.vue'
import UpdateDialog from '@/components/common/UpdateDialog.vue'

const mocks = vi.hoisted(() => ({
  settings: { updateStrategy: 'auto' as 'auto' | 'manual' },
  getBuildInfo: vi.fn(),
  checkDevelopmentUpdate: vi.fn(),
  checkRelease: vi.fn(),
  message: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/stores/settings', () => ({ useSettingsStore: () => mocks.settings }))
vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({
    getBuildInfo: mocks.getBuildInfo,
    checkDevelopmentUpdate: mocks.checkDevelopmentUpdate,
  }),
}))
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mocks.checkRelease,
  Update: class {
    version: string
    body?: string

    constructor(metadata: { version: string; body?: string }) {
      this.version = metadata.version
      this.body = metadata.body
    }
  },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ message: mocks.message }))
vi.mock('@/utils/format', () => ({ formatTime: (value: number) => String(value) }))
vi.mock('@/utils/updateCheck', () => ({
  LAST_UPDATE_CHECK_EVENT: 'update-check',
  isNetworkUpdateCheckError: () => false,
  readLastUpdateCheckTime: () => null,
  recordLastUpdateCheckTime: () => 1,
  updateCheckErrorMessage: (error: unknown) => {
    if (error && typeof error === 'object' && 'message' in error) return String(error.message)
    return String(error)
  },
}))

describe('UpdateSection strategy controls', () => {
  beforeEach(() => {
    mocks.settings.updateStrategy = 'auto'
    mocks.getBuildInfo.mockReset().mockResolvedValue({ version: '1.0.0', git_hash: null })
    mocks.checkDevelopmentUpdate.mockReset().mockResolvedValue(null)
    mocks.checkRelease.mockReset().mockResolvedValue(null)
    mocks.message.mockReset().mockResolvedValue(undefined)
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

  it('checks the development channel independently from release updates', async () => {
    mocks.checkDevelopmentUpdate.mockResolvedValue({
      rid: 7,
      current_version: '1.0.0',
      version: '1.0.1-dev.42',
      date: null,
      body: 'main @ abcdef0',
      raw_json: {},
    })
    const wrapper = shallowMount(UpdateSection)
    await flushPromises()

    await wrapper.find('.development-check-btn').trigger('click')
    await flushPromises()

    expect(mocks.checkDevelopmentUpdate).toHaveBeenCalledOnce()
    expect(mocks.checkRelease).not.toHaveBeenCalled()
    const dialog = wrapper.findComponent(UpdateDialog)
    expect(dialog.props('visible')).toBe(true)
    expect(dialog.props('channel')).toBe('development')
    expect(dialog.props('update')).toMatchObject({
      version: '1.0.1-dev.42',
      body: 'main @ abcdef0',
    })
  })

  it('reports when the development channel has no newer build', async () => {
    const wrapper = shallowMount(UpdateSection)
    await flushPromises()

    await wrapper.find('.development-check-btn').trigger('click')
    await flushPromises()

    expect(mocks.message).toHaveBeenCalledWith(
      'settings.about.noDevelopmentUpdateFound',
      {
        title: 'settings.about.checkDevelopmentUpdate',
        kind: 'info',
      },
    )
  })

  it('shows the message from a structured development update error', async () => {
    mocks.checkDevelopmentUpdate.mockRejectedValue({
      kind: 'OperationFailed',
      message: 'development endpoint unavailable',
    })
    const wrapper = shallowMount(UpdateSection)
    await flushPromises()

    await wrapper.find('.development-check-btn').trigger('click')
    await flushPromises()

    expect(mocks.message).toHaveBeenCalledWith(
      'settings.about.updateError：development endpoint unavailable',
      { title: '错误', kind: 'error' },
    )
  })
})
