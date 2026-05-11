import { describe, expect, it, vi } from 'vitest'
import {
  scrollElementByWheel,
  wheelDeltaToPixels,
} from './wheelScroll'

function makeWheelEvent(init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { cancelable: true, ...init })
  vi.spyOn(event, 'preventDefault')
  return event
}

describe('wheelScroll', () => {
  it('converts line and page deltas to pixels', () => {
    expect(wheelDeltaToPixels({ deltaX: 1, deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE }, 24, 300, 600)).toEqual({
      dx: 24,
      dy: 72,
    })
    expect(wheelDeltaToPixels({ deltaX: 1, deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE }, 24, 300, 600)).toEqual({
      dx: 300,
      dy: 600,
    })
  })

  it('actively applies vertical wheel deltas to the scroll container', () => {
    const element = document.createElement('div')
    const event = makeWheelEvent({ deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE })

    const handled = scrollElementByWheel(event, element, { lineSize: 20 })

    expect(handled).toBe(true)
    expect(element.scrollTop).toBe(60)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('applies horizontal deltas when enabled', () => {
    const element = document.createElement('div')
    const event = makeWheelEvent({ deltaX: 7, deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PIXEL })

    const handled = scrollElementByWheel(event, element, { allowHorizontal: true })

    expect(handled).toBe(true)
    expect(element.scrollLeft).toBe(7)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })
})
