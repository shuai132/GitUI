import { beforeEach, describe, expect, it } from 'vitest'
import {
  CLONE_PARENT_DIR_KEY,
  loadCloneParentDir,
  saveCloneParentDir,
} from './clonePreferences'

describe('clonePreferences', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips the most recent clone parent directory', () => {
    saveCloneParentDir('/Users/me/work')

    expect(loadCloneParentDir()).toBe('/Users/me/work')
  })

  it('removes the preference when the directory is cleared', () => {
    localStorage.setItem(CLONE_PARENT_DIR_KEY, '/Users/me/work')

    saveCloneParentDir('  ')

    expect(loadCloneParentDir()).toBe('')
    expect(localStorage.getItem(CLONE_PARENT_DIR_KEY)).toBeNull()
  })
})
