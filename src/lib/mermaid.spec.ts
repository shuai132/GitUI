import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_MERMAID_CHARS, renderMermaid } from './mermaid'
const mocks = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock('mermaid', () => ({ default: mocks }))
beforeEach(() => { mocks.initialize.mockReset(); mocks.render.mockReset().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>' }) })

describe('Mermaid render queue', () => {
  it('serializes initialization and isolates diagram output as SVG images', async () => {
    const results = await Promise.all([renderMermaid('graph LR; A-->B', true, () => true), renderMermaid('sequenceDiagram\nA->>B: Hi', false, () => true)])
    expect(mocks.initialize.mock.calls[0][0]).toMatchObject({ securityLevel: 'strict', theme: 'dark', startOnLoad: false, maxEdges: 300 })
    expect(mocks.initialize.mock.calls[1][0]).toMatchObject({ theme: 'default' })
    expect(mocks.initialize.mock.calls[0][0].secure).toContain('securityLevel')
    expect(results.every((value) => value?.startsWith('data:image/svg+xml;charset=utf-8,'))).toBe(true)
    expect(mocks.render.mock.calls[0][0]).not.toBe(mocks.render.mock.calls[1][0])
    expect(document.body.childElementCount).toBe(0)
  })
  it('skips stale queued jobs and rejects complexity before loading or rendering', async () => {
    expect(await renderMermaid('graph LR; A-->B', true, () => false)).toBeNull()
    await expect(renderMermaid('x'.repeat(MAX_MERMAID_CHARS + 1), true, () => true)).rejects.toThrow('too-large')
    expect(mocks.render).not.toHaveBeenCalled()
  })
  it('cleans temporary DOM after failure and allows subsequent diagrams to render', async () => {
    mocks.render.mockRejectedValueOnce(new Error('parse error'))
    await expect(renderMermaid('invalid', false, () => true)).rejects.toThrow('parse error')
    expect(document.body.childElementCount).toBe(0)
    expect(await renderMermaid('graph LR; A-->B', false, () => true)).toContain('data:image/svg+xml')
  })
})
