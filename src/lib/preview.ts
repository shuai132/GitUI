/**
 * 文件预览类型检测：根据扩展名判断是否可以走图片预览分支。
 *
 * - `raster`：浏览器原生 `<img>` 可渲染的位图
 * - `svg`：矢量图，同时也是文本，支持图片 / 文本双视图
 * - `null`：不支持预览，走普通文本 diff
 */
export type PreviewKind = 'raster' | 'svg' | null

export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
}

export function detectPreviewKind(path?: string | null): PreviewKind {
  if (!path) return null
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'svg') return 'svg'
  if (ext in MIME_BY_EXT) return 'raster'
  return null
}

export function mimeFor(path?: string | null): string {
  if (!path) return 'application/octet-stream'
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}
