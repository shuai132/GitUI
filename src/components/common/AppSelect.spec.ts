import { h, nextTick, ref } from 'vue'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppSelect from './AppSelect.vue'
import Modal from './Modal.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const options = [
  { value: 0, label: 'Disabled interval' },
  { value: 300, label: 'Five minutes', disabled: true },
  { value: 600, label: 'Ten minutes' },
]
const bounds = { x: 100, y: 100, left: 100, top: 100, right: 300, bottom: 132, width: 200, height: 32, toJSON: () => ({}) }
const disconnect = vi.fn()
const mountSelect = (props: Partial<Parameters<typeof AppSelect<number>>[0]> = {}) => mount(AppSelect<number>, {
  attachTo: document.body,
  props: { modelValue: 0, options, ariaLabel: 'Interval', ...props },
})
function key(target: Element, value: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra })
  target.dispatchEvent(event)
  return event
}
function option(label: string) {
  const target = Array.from(document.querySelectorAll<HTMLElement>('[role=option]')).find(node => node.textContent?.trim() === label)
  if (!target) throw new Error(`Missing option: ${label}`)
  return target
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(bounds)
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({
    0: bounds, length: 1, item: () => bounds, [Symbol.iterator]: () => [bounds][Symbol.iterator](),
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect })
  disconnect.mockClear()
})
afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

enableAutoUnmount(afterEach)

describe('AppSelect', () => {
  it('keeps numeric values, skips disabled options, and commits only on confirmation', async () => {
    const wrapper = mountSelect()
    const control = wrapper.get('[role=combobox]')
    ;(control.element as HTMLElement).focus()
    await control.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(control.element)
    expect(control.attributes('aria-expanded')).toBe('true')
    await control.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(document.getElementById(control.attributes('aria-activedescendant') ?? '')?.textContent).toContain('Ten minutes')
    await control.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toEqual([[600]])
    expect(control.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(control.element)
  })

  it('supports mouse selection and ignores disabled options', async () => {
    const wrapper = mountSelect()
    await wrapper.get('[role=combobox]').trigger('click')
    await flushPromises()
    option('Five minutes').click()
    expect(wrapper.emitted('select')).toBeUndefined()
    option('Ten minutes').click()
    await nextTick()
    expect(wrapper.emitted('select')).toEqual([[600]])
    expect(document.querySelector('[role=listbox]')).toBeNull()
  })

  it('cancels navigation with Escape without changing the model', async () => {
    const wrapper = mountSelect()
    const control = wrapper.get('[role=combobox]')
    await control.trigger('click')
    await flushPromises()
    await control.trigger('keydown', { key: 'End' })
    await control.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(control.text()).toBe('Disabled interval')
    expect(control.attributes('aria-activedescendant')).toBeUndefined()
  })

  it('offers typeahead and Home/End without changing the value until Enter', async () => {
    const wrapper = mountSelect()
    const control = wrapper.get('[role=combobox]')
    await control.trigger('keydown', { key: 't' })
    expect(document.getElementById(control.attributes('aria-activedescendant') ?? '')?.textContent).toContain('Ten minutes')
    await control.trigger('keydown', { key: 'Home' })
    expect(document.getElementById(control.attributes('aria-activedescendant') ?? '')?.textContent).toContain('Disabled interval')
    await control.trigger('keydown', { key: 'End' })
    await control.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toEqual([[600]])
  })

  it('searches labels, preserves selection on no match, and retains native text editing', async () => {
    const wrapper = mountSelect({ searchable: true })
    const input = wrapper.get('input')
    await input.trigger('click')
    await flushPromises()
    await input.setValue('TEN')
    expect(document.querySelectorAll('[role=option]')).toHaveLength(1)
    expect(key(input.element, 'Home').defaultPrevented).toBe(false)
    await input.setValue('missing')
    expect(document.querySelector('[role=status]')?.textContent).toContain('common.select.noResults')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await input.trigger('keydown', { key: 'Escape' })
    expect((input.element as HTMLInputElement).value).toBe('Disabled interval')
  })

  it('keeps free text, fallback font lists, and empty values immediately', async () => {
    const wrapper = mount(AppSelect<string>, {
      attachTo: document.body,
      props: { modelValue: '', options: [{ value: 'Menlo', label: 'Menlo' }], ariaLabel: 'Font', customValue: text => text },
    })
    const input = wrapper.get('input')
    await input.setValue('Custom Font, monospace')
    expect(wrapper.emitted('update:modelValue')).toEqual([['Custom Font, monospace']])
    await wrapper.setProps({ modelValue: 'Custom Font, monospace' })
    await input.trigger('keydown', { key: 'Escape' })
    expect((input.element as HTMLInputElement).value).toBe('Custom Font, monospace')
    await input.setValue('')
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([''])
    await input.setValue('men')
    option('Menlo').click()
    expect(wrapper.emitted('select')).toEqual([['Menlo']])
  })

  it('does not commit an IME composition with Enter', async () => {
    const wrapper = mountSelect({ searchable: true })
    const control = wrapper.get('input')
    await control.trigger('click')
    await flushPromises()
    key(control.element, 'Enter', { isComposing: true })
    await nextTick()
    expect(wrapper.emitted('select')).toBeUndefined()
    expect(control.attributes('aria-expanded')).toBe('true')
  })

  it('emits repeat selections for action controls with no selected value', async () => {
    const wrapper = mountSelect({ modelValue: null })
    for (let i = 0; i < 2; i++) {
      await wrapper.get('[role=combobox]').trigger('click')
      await flushPromises()
      option('Ten minutes').click()
      await nextTick()
    }
    expect(wrapper.emitted('select')).toEqual([[600], [600]])
  })

  it('closes when disabled or loading and never opens an unavailable control', async () => {
    const wrapper = mountSelect()
    const control = wrapper.get('[role=combobox]')
    await control.trigger('click')
    await flushPromises()
    await wrapper.setProps({ disabled: true })
    expect(control.attributes('aria-expanded')).toBe('false')
    await wrapper.setProps({ disabled: false, loading: true })
    expect(control.attributes('aria-busy')).toBe('true')
    await control.trigger('keydown', { key: 'ArrowDown' })
    expect(document.querySelector('[role=listbox]')).toBeNull()
  })

  it('handles empty/all-disabled lists and options changing while open', async () => {
    const wrapper = mountSelect({ options: [] })
    const control = wrapper.get('[role=combobox]')
    await control.trigger('click')
    await flushPromises()
    await control.trigger('keydown', { key: 'ArrowDown' })
    await control.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')).toBeUndefined()
    await wrapper.setProps({ options: [options[1]] })
    await control.trigger('keydown', { key: 'End' })
    expect(control.attributes('aria-activedescendant')).toBeUndefined()
    await wrapper.setProps({ options })
    await control.trigger('keydown', { key: 'End' })
    await control.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')).toEqual([[600]])
  })

  it('closes on outside click/blur, follows visible scrolling, and closes when scrolled out', async () => {
    const wrapper = mountSelect()
    await wrapper.get('[role=combobox]').trigger('click')
    await flushPromises()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()
    expect(document.querySelector('[role=listbox]')).toBeNull()
    await wrapper.get('[role=combobox]').trigger('click')
    await flushPromises()
    await wrapper.get('[role=combobox]').trigger('blur')
    expect(document.querySelector('[role=listbox]')).toBeNull()
    await wrapper.get('[role=combobox]').trigger('click')
    await flushPromises()
    const rect = vi.spyOn(wrapper.get('[role=combobox]').element, 'getBoundingClientRect')
    rect.mockReturnValue({ ...bounds, y: 200, top: 200, bottom: 232 })
    window.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.select-popup')?.style.top).toBe('236px'))
    rect.mockReturnValue({ ...bounds, y: -132, top: -132, bottom: -100 })
    window.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(document.querySelector('[role=listbox]')).toBeNull())
    expect(disconnect).toHaveBeenCalledTimes(3)
    expect(document.querySelector('[role=listbox]')).toBeNull()
  })

  it('keeps ten thousand options accessible with bounded mounted rows', async () => {
    const many = Array.from({ length: 10_000 }, (_, value) => ({ value, label: `Branch ${value}` }))
    const wrapper = mountSelect({ options: many, modelValue: 9999 })
    const control = wrapper.get('[role=combobox]')
    await control.trigger('click')
    await flushPromises()
    expect(document.querySelectorAll('[role=option]').length).toBeLessThan(30)
    expect(document.getElementById(control.attributes('aria-activedescendant') ?? '')?.textContent).toContain('Branch 9999')
    await control.trigger('keydown', { key: 'Home' })
    await control.trigger('keydown', { key: 'End' })
    await control.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')).toEqual([[9999]])
  })

  it('removes its popup and observer when the owning view unmounts', async () => {
    const visible = ref(true)
    const wrapper = mount({
      setup: () => () => visible.value ? h(AppSelect<number>, { modelValue: 0, options, ariaLabel: 'Interval' }) : null,
    }, { attachTo: document.body })
    await wrapper.get('[role=combobox]').trigger('click')
    await flushPromises()
    visible.value = false
    await nextTick()
    expect(document.querySelector('[role=listbox]')).toBeNull()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('flips above and clamps horizontally near the viewport edges', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ ...bounds,
      x: window.innerWidth - 120, left: window.innerWidth - 120, right: window.innerWidth + 80,
      y: window.innerHeight - 45, top: window.innerHeight - 45, bottom: window.innerHeight - 13,
    })
    const wrapper = mountSelect()
    await wrapper.get('[role=combobox]').trigger('click')
    await flushPromises()
    const popup = document.querySelector<HTMLElement>('.select-popup')!
    expect(parseFloat(popup.style.top)).toBeLessThan(window.innerHeight - 45)
    expect(parseFloat(popup.style.left) + parseFloat(popup.style.width)).toBeLessThanOrEqual(window.innerWidth - 8)
  })

  it('uses Escape for the popup first, then the modal, without moving focus outside it', async () => {
    const wrapper = mount(Modal, {
      attachTo: document.body, props: { visible: true, title: 'Settings' },
      slots: { default: () => h(AppSelect<number>, { modelValue: 0, options, ariaLabel: 'Interval' }) },
    })
    await flushPromises()
    const control = document.querySelector<HTMLElement>('[role=combobox]')!
    control.click()
    await nextTick()
    expect(document.querySelector('[role=dialog] [role=listbox]')).not.toBeNull()
    key(control, 'Escape')
    await nextTick()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(document.activeElement).toBe(control)
    expect(document.querySelector('[role=listbox]')).toBeNull()
    key(control, 'Escape')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closes on Tab while allowing the modal to wrap focus', async () => {
    const wrapper = mount(Modal, {
      attachTo: document.body, props: { visible: true, title: 'Settings' },
      slots: { default: () => [h('button', { id: 'first' }, 'First'), h(AppSelect<number>, { modelValue: 0, options, ariaLabel: 'Interval' })] },
    })
    await flushPromises()
    const control = document.querySelector<HTMLElement>('[role=combobox]')!
    control.focus()
    control.click()
    await nextTick()
    key(control, 'Tab')
    await nextTick()
    expect(document.activeElement?.id).toBe('first')
    expect(document.querySelector('[role=listbox]')).toBeNull()
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
