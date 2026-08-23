import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Update } from '@tauri-apps/plugin-updater'
import UpdateDialog from './UpdateDialog.vue'

const mocks = vi.hoisted(() => ({
  skippedVersion: null as string | null,
  relaunch: vi.fn(),
  openUrl: vi.fn(),
  showActionError: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => mocks,
}))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: mocks.openUrl }))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({ showActionError: mocks.showActionError }),
}))

const ModalStub = defineComponent({
  props: { visible: Boolean },
  template: '<div v-if="visible"><slot /><slot name="footer" /></div>',
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function response(body: string): Response {
  return {
    ok: true,
    json: async () => ({ body }),
  } as Response
}

function update(
  version: string,
  downloadAndInstall = vi.fn().mockResolvedValue(undefined),
): Pick<Update, 'version' | 'downloadAndInstall'> {
  return {
    version,
    downloadAndInstall: downloadAndInstall as unknown as Update['downloadAndInstall'],
  }
}

describe('UpdateDialog release context', () => {
  beforeEach(() => {
    mocks.skippedVersion = null
    mocks.relaunch.mockReset().mockResolvedValue(undefined)
    mocks.openUrl.mockReset().mockResolvedValue(undefined)
    mocks.showActionError.mockReset()
    vi.unstubAllGlobals()
  })

  it('sanitizes remote release-note HTML before rendering it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(
      '# Safe title\n\n<img src="x" onerror="alert(1)">\n\n[bad](javascript:alert(1))',
    )))
    const wrapper = mount(UpdateDialog, {
      props: { visible: true, update: update('1.0.0') },
      global: { stubs: { Modal: ModalStub } },
    })
    await flushPromises()

    const html = wrapper.find('.release-notes-md').html()
    expect(html).toContain('Safe title')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
  })

  it('does not let older release notes overwrite the current version', async () => {
    const oldRequest = deferred<Response>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(response('Beta notes'))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(UpdateDialog, {
      props: { visible: true, update: update('1.0.0') },
      global: { stubs: { Modal: ModalStub } },
    })

    await wrapper.setProps({ update: update('2.0.0') })
    await flushPromises()
    expect(wrapper.text()).toContain('Beta notes')

    oldRequest.resolve(response('Alpha notes'))
    await flushPromises()

    expect(wrapper.text()).toContain('Beta notes')
    expect(wrapper.text()).not.toContain('Alpha notes')
  })

  it('resets downloaded state when a different update arrives', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response))
    const firstDownload = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(UpdateDialog, {
      props: { visible: true, update: update('1.0.0', firstDownload) },
      global: { stubs: { Modal: ModalStub } },
    })
    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper.find('.btn-primary').text()).toBe('settings.about.restartNow')

    await wrapper.setProps({ update: update('2.0.0') })
    await flushPromises()

    expect(wrapper.find('.version-badge').text()).toBe('v2.0.0')
    expect(wrapper.find('.btn-primary').text()).toBe('settings.about.updateNow')
  })

  it('reports failures to open Releases without an unhandled rejection', async () => {
    const openError = new Error('opener unavailable')
    mocks.openUrl.mockRejectedValue(openError)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response))
    const wrapper = mount(UpdateDialog, {
      props: { visible: true, update: update('1.0.0') },
      global: { stubs: { Modal: ModalStub } },
    })
    await flushPromises()

    await wrapper.find('.release-notes-link').trigger('click')
    await flushPromises()

    expect(mocks.showActionError).toHaveBeenCalledWith(
      openError,
      'settings.about.openReleasesFailed',
    )
  })

  it('reports relaunch failure after downloading the update', async () => {
    const restartError = new Error('relaunch unavailable')
    mocks.relaunch.mockRejectedValue(restartError)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response))
    const wrapper = mount(UpdateDialog, {
      props: { visible: true, update: update('1.0.0') },
      global: { stubs: { Modal: ModalStub } },
    })
    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(mocks.showActionError).toHaveBeenCalledWith(
      restartError,
      'settings.about.restartFailed',
    )
  })
})
