import { describe, expect, it } from 'vitest'
import { isSafeExternalMarkdownUrl, renderMarkdownPreview } from './markdownPreview'

describe('markdownPreview', () => {
  it('renders common Markdown blocks and highlighted code fences', () => {
    const html = renderMarkdownPreview([
      '# Title',
      '',
      '- one',
      '- two',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```ts',
      'const value: number = 1',
      '```',
    ].join('\n'), true)

    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<table>')
    expect(html).toContain('hljs')
  })

  it('sanitizes unsafe raw HTML', () => {
    const html = renderMarkdownPreview([
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
    ].join('\n'), false)

    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('onerror')
  })

  it('does not emit clickable dangerous links', () => {
    const html = renderMarkdownPreview([
      '[bad](javascript:alert(1))',
      '',
      '[local](file:///tmp/secret)',
      '',
      '[ok](https://example.com)',
    ].join('\n'), false)

    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('href="file:')
    expect(html).toContain('markdown-link--disabled')
    expect(html).toContain('data-markdown-link="external"')
  })

  it('renders Markdown images as placeholders instead of img tags', () => {
    const html = renderMarkdownPreview('![diagram](./diagram.png)', false)

    expect(html).not.toContain('<img')
    expect(html).toContain('markdown-image-placeholder')
    expect(html).toContain('diagram')
  })

  it('allows only safe external link protocols', () => {
    expect(isSafeExternalMarkdownUrl('https://example.com')).toBe(true)
    expect(isSafeExternalMarkdownUrl('http://example.com')).toBe(true)
    expect(isSafeExternalMarkdownUrl('mailto:user@example.com')).toBe(true)
    expect(isSafeExternalMarkdownUrl('./relative.md')).toBe(false)
    expect(isSafeExternalMarkdownUrl('javascript:alert(1)')).toBe(false)
  })
})
