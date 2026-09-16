import type { BlobData, FileDiff, FileStatusKind } from '@/types/git'

export type MarkdownWip = { staged: boolean; status?: FileStatusKind } | null
export type MarkdownSource = { kind: 'missing' } | { kind: 'blob'; oid: string } | { kind: 'worktree'; path: string }
export type MarkdownContent = { kind: 'ready'; text: string } | { kind: 'missing' | 'too-large' | 'error' }

// Bound parsing and DOM size independently of the binary preview IPC limit.
export const MAX_MARKDOWN_BYTES = 512 * 1024

export function markdownSource(diff: FileDiff, side: 'old' | 'new', wip: MarkdownWip): MarkdownSource {
  if (side === 'old') return diff.old_blob_oid ? { kind: 'blob', oid: diff.old_blob_oid } : { kind: 'missing' }
  if (wip && !wip.staged) {
    if (wip.status === 'deleted' || diff.new_file_mode === 0 || !diff.new_path) return { kind: 'missing' }
    return { kind: 'worktree', path: diff.new_path }
  }
  return diff.new_blob_oid ? { kind: 'blob', oid: diff.new_blob_oid } : { kind: 'missing' }
}

export async function loadMarkdownContent(
  source: MarkdownSource,
  encoding: string,
  readers: { blob: (oid: string) => Promise<BlobData>; worktree: (path: string) => Promise<BlobData> },
): Promise<MarkdownContent> {
  if (source.kind === 'missing') return { kind: 'missing' }
  try {
    const data = await (source.kind === 'blob' ? readers.blob(source.oid) : readers.worktree(source.path))
    if (data.truncated || data.size > MAX_MARKDOWN_BYTES) return { kind: 'too-large' }
    const binary = atob(data.bytes_base64)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    const label = encoding.toUpperCase() === 'UTF-8 BOM' ? 'utf-8' : encoding
    let text: string
    try {
      text = new TextDecoder(label).decode(bytes)
    } catch {
      text = new TextDecoder().decode(bytes)
    }
    return { kind: 'ready', text }
  } catch {
    return { kind: 'error' }
  }
}
