import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { useGitEvents } from './useGitEvents'

const mocks = vi.hoisted(() => ({ listen: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))

describe('useGitEvents lifecycle', () => {
  it('removes an event listener registered after its component has unmounted', async () => {
    let registered!: (unlisten: () => void) => void
    mocks.listen.mockReturnValueOnce(new Promise<() => void>((resolve) => { registered = resolve }))
    const wrapper = mount(defineComponent({
      setup() { useGitEvents().onStatusChanged(() => {}) },
      template: '<div />',
    }))
    wrapper.unmount()
    const unlisten = vi.fn()
    registered(unlisten)
    await flushPromises()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })
})
