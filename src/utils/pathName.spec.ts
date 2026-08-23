import { describe, expect, it } from 'vitest'
import { isInvalidDirectoryLeafName } from './pathName'

describe('isInvalidDirectoryLeafName', () => {
  it.each(['.', '..', ' . ', ' .. ', 'nested/repo', 'nested\\repo'])(
    'rejects path aliases and separators in %j',
    (name) => {
      expect(isInvalidDirectoryLeafName(name)).toBe(true)
    },
  )

  it.each(['', 'repo', '.git', 'feature..next', 'name with spaces'])(
    'keeps ordinary leaf names valid in %j',
    (name) => {
      expect(isInvalidDirectoryLeafName(name)).toBe(false)
    },
  )
})
