import { describe, expect, it } from 'vitest'
import { matchesSidebarSearch, normalizeSidebarSearchQuery } from './sidebarSearch'

describe('sidebarSearch', () => {
  it('normalizes surrounding whitespace and letter case', () => {
    expect(normalizeSidebarSearchQuery('  FeAtUrE/Login  ')).toBe('feature/login')
  })

  it('matches any supplied display field without case sensitivity', () => {
    expect(matchesSidebarSearch('PAY', 'billing', 'feature/payments')).toBe(true)
    expect(matchesSidebarSearch('vendor', 'library', undefined, 'vendor/library')).toBe(true)
    expect(matchesSidebarSearch('missing', 'billing', 'feature/payments')).toBe(false)
  })

  it('treats a blank query as no filter', () => {
    expect(matchesSidebarSearch('   ', undefined)).toBe(true)
  })
})
