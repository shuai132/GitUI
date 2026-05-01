export interface PluginBackend {
  command: string
  args: string[]
}

export type PluginPermission = string | PluginPermissionDetail

export interface PluginPermissionDetail {
  id: string
  reason?: string
}

export interface PluginCommandContribution {
  id: string
  label: string
  description?: string
  category?: string
  enablement?: string
}

export interface PluginMenuContribution {
  location: string
  command: string
  group?: string
}

export interface PluginPanelContribution {
  id: string
  title: string
  location: string
  entry: string
}

export interface PluginSettingsContribution {
  id: string
  title: string
  entry: string
}

export interface PluginContributes {
  commands: PluginCommandContribution[]
  menus: PluginMenuContribution[]
  panels: PluginPanelContribution[]
  settings: PluginSettingsContribution[]
}

export interface PluginManifest {
  api_version: number
  id: string
  name: string
  version: string
  description?: string
  entry?: string
  backend?: PluginBackend
  permissions: PluginPermission[]
  contributes: PluginContributes
}

export interface PluginInfo {
  manifest: PluginManifest
  enabled: boolean
  path: string
}

export interface PluginCommandContext {
  repo_id?: string
  repo_path?: string
  selection?: unknown
}

export interface PluginCommandResult {
  message?: string
  refresh: string[]
}

export interface PluginMenuCommand {
  plugin_id: string
  command_id: string
  label: string
  description?: string
}
