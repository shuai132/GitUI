import { describe, expect, it } from 'vitest'
import en from './en'
import zhCN from './zh-CN'

describe('file list view labels', () => {
  it('defines localized labels for every icon-only view action', () => {
    const english = en.workspace.wip
    const chinese = zhCN.workspace.wip
    const keys = [
      'expandAllTitle',
      'collapseAllTitle',
      'switchToTreeView',
      'switchToListView',
    ] as const

    for (const key of keys) {
      expect(english[key]).toBeTruthy()
      expect(chinese[key]).toBeTruthy()
      expect(chinese[key]).not.toBe(english[key])
    }
  })
})
