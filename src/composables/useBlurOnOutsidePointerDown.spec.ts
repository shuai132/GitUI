import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBlurOnOutsidePointerDown } from './useBlurOnOutsidePointerDown'

function makeComponent(onBlurred = vi.fn()) {
  return defineComponent({
    setup() {
      const rootEl = ref<HTMLElement | null>(null)
      useBlurOnOutsidePointerDown(rootEl, onBlurred)
      return { rootEl }
    },
    template: `
      <div ref="rootEl" data-test="root">
        <button type="button">Search</button>
      </div>
    `,
  })
}

describe('useBlurOnOutsidePointerDown', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('blurs focus contained by the root when pointerdown happens outside', () => {
    const onBlurred = vi.fn()
    const wrapper = mount(makeComponent(onBlurred), { attachTo: document.body })
    const button = wrapper.get('button').element as HTMLButtonElement

    button.focus()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))

    expect(document.activeElement).not.toBe(button)
    expect(onBlurred).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('keeps focus when pointerdown happens inside the root', () => {
    const onBlurred = vi.fn()
    const wrapper = mount(makeComponent(onBlurred), { attachTo: document.body })
    const button = wrapper.get('button').element as HTMLButtonElement

    button.focus()
    wrapper.get('[data-test="root"]').element.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true }),
    )

    expect(document.activeElement).toBe(button)
    expect(onBlurred).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})
