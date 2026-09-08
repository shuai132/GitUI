import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import CommitListHeader from './CommitListHeader.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

describe('CommitListHeader graph boundary', () => {
  it('keeps the graph resize handle separate from data column resizing and reordering', async () => {
    const wrapper = mount(CommitListHeader, {
      props: {
        commitListMinWidth: 800,
        headerScrollLeft: 80,
        graphColWidth: 160,
        columns: [
          { id: 'date', className: 'col-date', width: 170, resizeCol: 'date', label: 'Date' },
          { id: 'description', className: 'col-message', width: 400, resizeCol: 'desc', label: 'Description' },
        ],
      },
    })

    const graphHandle = wrapper.get('.col-graph .col-resize')
    graphHandle.element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 80, bubbles: true }))
    expect(wrapper.emitted('colResizeStart')?.[0]?.[1]).toBe('graph')
    expect(wrapper.emitted('dragHandlePointerDown')).toBeUndefined()

    wrapper.get('[data-history-column="description"] .col-resize').element.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, bubbles: true }),
    )
    expect(wrapper.emitted('colResizeStart')?.[1]?.[1]).toBe('desc')
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 500 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(wrapper.emitted('columnReorder')).toBeUndefined()

    await wrapper.setProps({ graphColWidth: 240 })
    expect(wrapper.get('.col-graph').attributes('style')).toContain('width: 240px')
    expect(wrapper.get('.col-header').attributes('style')).toContain('translateX(-80px)')
    wrapper.unmount()
  })
})
