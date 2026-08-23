import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContextMenu from './ContextMenu.vue'

type TestMenuItem = {
  separator?: boolean
  label?: string
  action?: string
  disabled?: boolean
  children?: TestMenuItem[]
}

function dispatchMouse(target: EventTarget, type: string, button = 0) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button,
    }),
  )
}

function dispatchKey(key: string) {
  const target = document.activeElement ?? document
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
    }),
  )
}

async function mountOpenMenu(items: TestMenuItem[] = [{ label: 'Copy', action: 'copy' }]) {
  const wrapper = mount(ContextMenu, {
    attachTo: document.body,
    props: {
      visible: false,
      x: 10,
      y: 10,
      items,
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

  it('exposes menu semantics and cycles focus across enabled items', async () => {
    const wrapper = await mountOpenMenu([
      { label: 'Disabled', action: 'disabled', disabled: true },
      { separator: true },
      { label: 'Copy', action: 'copy' },
      { label: 'Delete', action: 'delete' },
    ])
    const menu = document.querySelector<HTMLElement>('.context-menu')
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))

    expect(menu?.getAttribute('role')).toBe('menu')
    expect(document.querySelector('[role="separator"]')).not.toBeNull()
    expect(items[0]?.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement?.textContent).toContain('Copy')

    dispatchKey('ArrowDown')
    expect(document.activeElement?.textContent).toContain('Delete')
    dispatchKey('ArrowDown')
    expect(document.activeElement?.textContent).toContain('Copy')
    dispatchKey('ArrowUp')
    expect(document.activeElement?.textContent).toContain('Delete')
    dispatchKey('Home')
    expect(document.activeElement?.textContent).toContain('Copy')
    dispatchKey('End')
    expect(document.activeElement?.textContent).toContain('Delete')

    wrapper.unmount()
  })

  it('runs the focused item with Enter and closes the menu', async () => {
    const wrapper = await mountOpenMenu()

    dispatchKey('Enter')

    expect(wrapper.emitted('select')).toEqual([['copy']])
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('opens and leaves a submenu with horizontal arrow keys', async () => {
    const wrapper = await mountOpenMenu([
      {
        label: 'Branch',
        children: [
          { label: 'Unavailable', action: 'unavailable', disabled: true },
          { label: 'Checkout', action: 'checkout' },
        ],
      },
    ])

    dispatchKey('ArrowRight')
    await nextTick()

    const submenu = document.querySelector<HTMLElement>('.submenu')
    expect(submenu?.getAttribute('role')).toBe('menu')
    expect(document.activeElement?.textContent).toContain('Checkout')

    dispatchKey('ArrowLeft')
    await nextTick()

    expect(document.querySelector('.submenu')).toBeNull()
    expect(document.activeElement?.textContent).toContain('Branch')
    wrapper.unmount()
  })

  it('restores focus to the opener after closing', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const wrapper = await mountOpenMenu()

    expect(document.activeElement?.textContent).toContain('Copy')
    await wrapper.setProps({ visible: false })

    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
  })

  it('cancels delayed listener setup when closed immediately', async () => {
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
    await wrapper.setProps({ visible: false })
    vi.runOnlyPendingTimers()

    dispatchMouse(document.body, 'pointerdown')

    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })
})
