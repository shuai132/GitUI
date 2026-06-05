import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Modal from './Modal.vue'

function dispatchEscape() {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  })
  document.dispatchEvent(event)
  return event
}

function mountVisibleModal(title = 'Dialog') {
  return mount(Modal, {
    attachTo: document.body,
    props: {
      visible: true,
      title,
    },
    slots: {
      default: 'Body',
    },
  })
}

describe('Modal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('handles Escape immediately and prevents global key handlers from seeing it', async () => {
    const globalKeydown = vi.fn()
    document.addEventListener('keydown', globalKeydown)
    const wrapper = mountVisibleModal()
    await nextTick()

    const event = dispatchEscape()

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(event.defaultPrevented).toBe(true)
    expect(globalKeydown).not.toHaveBeenCalled()

    document.removeEventListener('keydown', globalKeydown)
    wrapper.unmount()
  })

  it('only lets the topmost modal handle Escape', async () => {
    const first = mountVisibleModal('First')
    const second = mountVisibleModal('Second')
    await nextTick()

    dispatchEscape()

    expect(first.emitted('close')).toBeUndefined()
    expect(second.emitted('close')).toHaveLength(1)

    first.unmount()
    second.unmount()
  })

  it('does not close while shortcut recording is handling Escape', async () => {
    const wrapper = mountVisibleModal()
    const recordingButton = document.createElement('button')
    recordingButton.className = 'shortcut-key recording'
    document.body.appendChild(recordingButton)
    const recordingKeydown = vi.fn((event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    })
    document.addEventListener('keydown', recordingKeydown, { capture: true })
    await nextTick()

    dispatchEscape()

    expect(recordingKeydown).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('close')).toBeUndefined()

    document.removeEventListener('keydown', recordingKeydown, { capture: true })
    recordingButton.remove()
    wrapper.unmount()
  })
})
