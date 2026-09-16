import { describe, expect, it, vi } from 'vitest'
import type { BlobData, FileDiff } from '@/types/git'
import { loadMarkdownContent, markdownSource, MAX_MARKDOWN_BYTES } from './markdownContent'

const diff: FileDiff = { old_path: 'before.md', new_path: 'after.md', old_blob_oid: 'old', new_blob_oid: 'new', is_binary: false, hunks: [], additions: 0, deletions: 0, encoding: 'UTF-8' }
const data = (bytes: number[]): BlobData => ({ bytes_base64: btoa(String.fromCharCode(...bytes)), size: bytes.length, truncated: false })

describe('Markdown content sources', () => {
  it('uses worktree content for unstaged changes even with no visible hunks', () => {
    expect(markdownSource({ ...diff, new_blob_oid: undefined }, 'new', { staged: false, status: 'modified' })).toEqual({ kind: 'worktree', path: 'after.md' })
  })
  it('uses index and historical blobs rather than subsequent worktree edits', () => {
    expect(markdownSource(diff, 'new', { staged: true })).toEqual({ kind: 'blob', oid: 'new' })
    expect(markdownSource(diff, 'new', null)).toEqual({ kind: 'blob', oid: 'new' })
    expect(markdownSource(diff, 'old', { staged: false })).toEqual({ kind: 'blob', oid: 'old' })
  })
  it('distinguishes an absent version from an existing empty worktree file', () => {
    expect(markdownSource({ ...diff, new_blob_oid: undefined }, 'new', { staged: false, status: 'deleted' })).toEqual({ kind: 'missing' })
    expect(markdownSource({ ...diff, new_file_mode: 0 }, 'new', { staged: false })).toEqual({ kind: 'missing' })
    expect(markdownSource({ ...diff, old_blob_oid: undefined }, 'old', null)).toEqual({ kind: 'missing' })
    expect(markdownSource({ ...diff, new_blob_oid: undefined }, 'new', { staged: false, status: 'untracked' })).toEqual({ kind: 'worktree', path: 'after.md' })
  })
  it('decodes UTF-8 BOM and legacy encodings', async () => {
    const readers = { blob: vi.fn().mockResolvedValue(data([0xef, 0xbb, 0xbf, 0x23, 0x20, 0xe4, 0xb8, 0xad])), worktree: vi.fn() }
    expect(await loadMarkdownContent({ kind: 'blob', oid: 'old' }, 'UTF-8 BOM', readers)).toEqual({ kind: 'ready', text: '# 中' })
    readers.blob.mockResolvedValue(data([0xd6, 0xd0, 0xce, 0xc4]))
    expect(await loadMarkdownContent({ kind: 'blob', oid: 'old' }, 'GBK', readers)).toEqual({ kind: 'ready', text: '中文' })
  })
  it('returns empty text for a real empty file and avoids reading absent sides', async () => {
    const readers = { blob: vi.fn(), worktree: vi.fn().mockResolvedValue(data([])) }
    expect(await loadMarkdownContent({ kind: 'missing' }, 'UTF-8', readers)).toEqual({ kind: 'missing' })
    expect(readers.blob).not.toHaveBeenCalled()
    expect(await loadMarkdownContent({ kind: 'worktree', path: 'empty.md' }, 'UTF-8', readers)).toEqual({ kind: 'ready', text: '' })
  })
  it('reports truncation, limits and read errors without rendering partial content', async () => {
    const readers = { blob: vi.fn().mockResolvedValue({ ...data([]), truncated: true }), worktree: vi.fn() }
    expect(await loadMarkdownContent({ kind: 'blob', oid: 'old' }, 'UTF-8', readers)).toEqual({ kind: 'too-large' })
    readers.blob.mockResolvedValue({ ...data([]), size: MAX_MARKDOWN_BYTES + 1 })
    expect(await loadMarkdownContent({ kind: 'blob', oid: 'old' }, 'UTF-8', readers)).toEqual({ kind: 'too-large' })
    readers.blob.mockRejectedValue(new Error('removed'))
    expect(await loadMarkdownContent({ kind: 'blob', oid: 'old' }, 'UTF-8', readers)).toEqual({ kind: 'error' })
  })
})
