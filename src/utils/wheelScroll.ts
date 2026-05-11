export interface WheelScrollOptions {
  lineSize?: number
  allowHorizontal?: boolean
}

export interface WheelScrollDelta {
  dx: number
  dy: number
}

export function wheelDeltaToPixels(
  event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>,
  lineSize: number,
  pageWidth: number,
  pageHeight: number,
): WheelScrollDelta {
  let dx = event.deltaX
  let dy = event.deltaY

  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    dx *= lineSize
    dy *= lineSize
  } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    dx *= pageWidth
    dy *= pageHeight
  }

  return { dx, dy }
}

// Windows WebView2 can fail to bubble wheel events from item rows to their
// native scroll container. Actively applying the wheel delta keeps long lists
// scrollable when the pointer is over a row.
export function scrollElementByWheel(
  event: WheelEvent,
  element: HTMLElement | null,
  options: WheelScrollOptions = {},
): boolean {
  if (!element) return false

  const { dx, dy } = wheelDeltaToPixels(
    event,
    options.lineSize ?? 16,
    element.clientWidth,
    element.clientHeight,
  )
  if (dx === 0 && dy === 0) return false

  if (options.allowHorizontal && Math.abs(dx) > Math.abs(dy)) {
    const before = element.scrollLeft
    element.scrollLeft += dx
    if (element.scrollLeft === before) return false
  } else {
    element.scrollTop += dy
  }

  event.preventDefault()
  return true
}
