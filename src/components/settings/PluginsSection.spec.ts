import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginInfo } from '@/types/plugin'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import PluginsSection from './PluginsSection.vue'

const plugin: PluginInfo = {
  manifest: {
    api_version: 1,
    id: 'com.example.demo',
    name: 'Demo',
    version: '1.2.3',
    permissions: [],
    contributes: { commands: [], menus: [], panels: [], settings: [] },
  },
  enabled: true,
  path: '/app-data/plugins/com.example.demo',
}

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  store: {
    plugins: [] as PluginInfo[],
    loading: false,
    loaded: true,
    error: null,
    load: vi.fn(),
    installFromPath: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    uninstall: vi.fn(),
  },
  showToast: vi.fn(),
  showError: vi.fn(),
  showActionError: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      `${key} ${Object.values(params ?? {}).join(' ')}`.trim(),
  }),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('@/stores/plugins', () => ({ usePluginsStore: () => mocks.store }))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showToast: mocks.showToast,
    showError: mocks.showError,
    showActionError: mocks.showActionError,
  }),
}))

describe('PluginsSection guarded uninstall', () => {
  beforeEach(() => {
    mocks.store.plugins = [{ ...plugin }]
    mocks.open.mockReset()
    mocks.store.installFromPath.mockReset()
    mocks.store.uninstall.mockReset().mockResolvedValue(undefined)
    mocks.showToast.mockReset()
    mocks.showError.mockReset()
    mocks.showActionError.mockReset()
  })

  it.each([
    [false, 'settings.plugins.installSuccess'],
    [true, 'settings.plugins.updateSuccess'],
  ])('reports whether install replaced an existing plugin', async (replaced, message) => {
    mocks.open.mockResolvedValue('/source/demo')
    mocks.store.installFromPath.mockResolvedValue(replaced)
    const wrapper = shallowMount(PluginsSection)

    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(mocks.store.installFromPath).toHaveBeenCalledWith('/source/demo')
    expect(mocks.showToast).toHaveBeenCalledWith('success', message)
  })

  it('reports install failures without changing the list', async () => {
    mocks.open.mockResolvedValue('/source/demo')
    const error = new Error('copy failed')
    mocks.store.installFromPath.mockRejectedValue(error)
    const wrapper = shallowMount(PluginsSection)

    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(mocks.showToast).not.toHaveBeenCalled()
    expect(mocks.showActionError).toHaveBeenCalledWith(error)
  })

  it('previews the exact plugin and uninstalls only after confirmation', async () => {
    const wrapper = shallowMount(PluginsSection)
    await wrapper.find('.btn-danger').trigger('click')
    const dialog = wrapper.findComponent(ConfirmDialog)

    expect(dialog.props('message')).toContain('Demo 1.2.3 com.example.demo')
    expect(dialog.props('message')).toContain(plugin.path)
    expect(mocks.store.uninstall).not.toHaveBeenCalled()
    dialog.vm.$emit('cancel')
    await flushPromises()
    expect(dialog.props('visible')).toBe(false)
    expect(mocks.store.uninstall).not.toHaveBeenCalled()

    await wrapper.find('.btn-danger').trigger('click')
    dialog.vm.$emit('confirm')
    await flushPromises()

    expect(mocks.store.uninstall).toHaveBeenCalledWith('com.example.demo')
    expect(mocks.showToast).toHaveBeenCalled()
  })

  it('cancels a stale confirmation after the plugin is replaced', async () => {
    const wrapper = shallowMount(PluginsSection)
    await wrapper.find('.btn-danger').trigger('click')
    mocks.store.plugins = [{
      ...plugin,
      manifest: { ...plugin.manifest, version: '2.0.0' },
    }]

    wrapper.findComponent(ConfirmDialog).vm.$emit('confirm')
    await flushPromises()

    expect(mocks.store.uninstall).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalled()
  })
})
