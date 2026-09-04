import { Update } from '@tauri-apps/plugin-updater'
import type { DevelopmentUpdateMetadata } from '@/types/git'

/** 将后端注册的开发版 updater 资源恢复为前端可下载、安装的 Update。 */
export function createDevelopmentUpdate(metadata: DevelopmentUpdateMetadata | null): Update | null {
  if (!metadata) return null
  return new Update({
    rid: metadata.rid,
    currentVersion: metadata.current_version,
    version: metadata.version,
    date: metadata.date ?? undefined,
    body: metadata.body ?? undefined,
    rawJson: metadata.raw_json,
  })
}
