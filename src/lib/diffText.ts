import type { BlobData, FileDiff } from '@/types/git'
import type { DiffSide } from '@/lib/highlight'
import type { FullFileContent } from '@/lib/fullFileDiff'

export interface DiffTextLoader {
  repoId: string
  diff: FileDiff
  wip?: { staged: boolean } | null
  getBlobBytes: (repoId: string, oid: string, silent?: boolean) => Promise<BlobData>
  readWorktreeFile: (repoId: string, relPath: string, silent?: boolean) => Promise<BlobData>
}

export async function loadDiffFullText(loader: DiffTextLoader): Promise<FullFileContent | null> {
  const [oldText, newText] = await Promise.all([
    loadDiffSideText(loader, 'old'),
    loadDiffSideText(loader, 'new'),
  ])
  if (oldText == null || newText == null) return null
  return { oldText, newText }
}

export async function loadDiffSideText(
  loader: DiffTextLoader,
  side: DiffSide,
): Promise<string | null> {
  try {
    if (side === 'old') {
      if (!loader.diff.old_blob_oid) return ''
      const blob = await loader.getBlobBytes(loader.repoId, loader.diff.old_blob_oid, true)
      return decodeBlobText(blob, loader.diff.encoding)
    }

    if (loader.wip && !loader.wip.staged && loader.diff.new_path && diffHasNewSide(loader.diff)) {
      const blob = await loader.readWorktreeFile(loader.repoId, loader.diff.new_path, true)
      return decodeBlobText(blob, loader.diff.encoding)
    }
    if (!loader.diff.new_blob_oid) return ''
    const blob = await loader.getBlobBytes(loader.repoId, loader.diff.new_blob_oid, true)
    return decodeBlobText(blob, loader.diff.encoding)
  } catch {
    return null
  }
}

export function diffHasNewSide(diff: FileDiff): boolean {
  if (diff.new_blob_oid) return true
  return diff.hunks.some((hunk) => hunk.new_lines > 0)
}

function decodeBlobText(blob: BlobData, encoding: string): string | null {
  if (blob.truncated) return null
  return decodeBase64Text(blob.bytes_base64, encoding)
}

export function decodeBase64Text(base64: string, encoding: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  try {
    return new TextDecoder(normalizeTextDecoderLabel(encoding)).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

function normalizeTextDecoderLabel(encoding: string): string {
  if (encoding.toUpperCase() === 'UTF-8 BOM') return 'utf-8'
  return encoding
}
