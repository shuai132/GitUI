import { describe, expect, it } from 'vitest'
import { detectPreviewKind } from './preview'

describe('preview', () => {
  it('detects Markdown preview files without taking over MDX', () => {
    expect(detectPreviewKind('README.md')).toBe('markdown')
    expect(detectPreviewKind('guide.markdown')).toBe('markdown')
    expect(detectPreviewKind('notes.mdown')).toBe('markdown')
    expect(detectPreviewKind('draft.mkd')).toBe('markdown')
    expect(detectPreviewKind('component.mdx')).toBeNull()
  })
})
