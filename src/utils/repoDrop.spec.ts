import { describe, expect, it } from 'vitest'
import {
  isDropPointInsideRect,
  normalizeDroppedRepoPaths,
  toLogicalDropPoint,
} from './repoDrop'

describe('repoDrop', () => {
  it('converts Tauri physical positions to browser logical coordinates', () => {
    expect(toLogicalDropPoint({ x: 420, y: 240 }, 2)).toEqual({ x: 210, y: 120 })
    expect(toLogicalDropPoint({ x: 12, y: 8 }, 0)).toEqual({ x: 12, y: 8 })
  })

  it('accepts points inside the target and its nearby margin', () => {
    const rect = { left: 10, top: 20, right: 110, bottom: 80 }

    expect(isDropPointInsideRect({ x: 60, y: 40 }, rect, 8)).toBe(true)
    expect(isDropPointInsideRect({ x: 6, y: 40 }, rect, 8)).toBe(true)
    expect(isDropPointInsideRect({ x: 1, y: 40 }, rect, 8)).toBe(false)
  })

  it('trims, normalizes trailing separators, and deduplicates paths', () => {
    expect(normalizeDroppedRepoPaths([
      ' /repos/alpha/ ',
      '/repos/alpha',
      'C:\\repos\\beta\\',
      'C:\\repos\\beta',
      '',
    ])).toEqual(['/repos/alpha', 'C:\\repos\\beta'])
  })
})
