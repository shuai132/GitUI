import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContextMenu from './ContextMenu.vue'

function dispatchMouse(target: EventTarget, type: string, button = 0) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button,
    }),
  )
}

async function mountOpenMenu() {
  const wrapper = mount(ContextMenu, {
    attachTo: document.body,
    props: {
      visible: false,
      x: 10,
      y: 10,
      items: [{ label: 'Copy', action: 'copy' }],
    },
  })

  await wrapper.setProps({ visible: true })
  vi.runOnlyPendingTimers()
  await nextTick()

  return wrapper
}

describe('ContextMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('closes on outside primary pointer down without triggering the outside click target', async () => {
    const wrapper = await mountOpenMenu()
    const outsideButton = document.createElement('button')
    let outsideClicks = 0
    outsideButton.addEventListener('click', () => {
      outsideClicks += 1
    })
    document.body.appendChild(outsideButton)

    dispatchMouse(outsideButton, 'pointerdown')
    dispatchMouse(outsideButton, 'click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(outsideClicks).toBe(0)

    wrapper.unmount()
  })

  it('keeps blocking the outside click after a long primary-button hold', async () => {
    const wrapper = await mountOpenMenu()
    const outsideButton = document.createElement('button')
    let outsideClicks = 0
    outsideButton.addEventListener('click', () => {
      outsideClicks += 1
    })
    document.body.appendChild(outsideButton)

    dispatchMouse(outsideButton, 'pointerdown')
    vi.advanceTimersByTime(1000)
    dispatchMouse(outsideButton, 'click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(outsideClicks).toBe(0)

    wrapper.unmount()
  })

  it('does not block a secondary-click target from opening its own context menu', async () => {
    const wrapper = await mountOpenMenu()
    const outsideRow = document.createElement('div')
    let contextMenuEvents = 0
    outsideRow.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      contextMenuEvents += 1
    })
    document.body.appendChild(outsideRow)

    dispatchMouse(outsideRow, 'pointerdown', 2)
    dispatchMouse(outsideRow, 'contextmenu', 2)

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(contextMenuEvents).toBe(1)

    wrapper.unmount()
  })
})
