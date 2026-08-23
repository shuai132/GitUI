import { describe, expect, it } from 'vitest'
import { resizePercentageFromKey } from './keyboardResize'

describe('resizePercentageFromKey', () => {
  it('steps, clamps, and jumps within the declared range', () => {
    expect(resizePercentageFromKey(50, 'ArrowUp', 15, 85)).toBe(45)
    expect(resizePercentageFromKey(50, 'ArrowDown', 15, 85)).toBe(55)
    expect(resizePercentageFromKey(16, 'ArrowLeft', 15, 85)).toBe(15)
    expect(resizePercentageFromKey(84, 'ArrowRight', 15, 85)).toBe(85)
    expect(resizePercentageFromKey(50, 'Home', 15, 85)).toBe(15)
    expect(resizePercentageFromKey(50, 'End', 15, 85)).toBe(85)
    expect(resizePercentageFromKey(50, 'Enter', 15, 85)).toBeNull()
  })
})
