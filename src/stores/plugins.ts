import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from '@/stores/repos'
import type {
  PluginCommandContext,
  PluginCommandResult,
  PluginInfo,
  PluginMenuCommand,
} from '@/types/plugin'

const TOOLBAR_ACTIONS_LOCATION = 'toolbar.actions'
const COMMIT_CONTEXT_LOCATION = 'commit.context'

export const usePluginsStore = defineStore('plugins', () => {
  const plugins = ref<PluginInfo[]>([])
  const loading = ref(false)
  const executing = ref<string | null>(null)
  const error = ref<string | null>(null)
  const loaded = ref(false)

  const git = useGitCommands()

  const enabledPlugins = computed(() =>
    plugins.value.filter((plugin) => plugin.enabled),
  )

  function menuCommandsForLocation(location: string): PluginMenuCommand[] {
    const result: PluginMenuCommand[] = []
    for (const plugin of enabledPlugins.value) {
      for (const menu of plugin.manifest.contributes.menus) {
        if (menu.location !== location) continue
        const command = plugin.manifest.contributes.commands.find(
          (item) => item.id === menu.command,
        )
        if (!command) continue
        result.push({
          plugin_id: plugin.manifest.id,
          command_id: command.id,
          label: command.category
            ? `${command.category}: ${command.label}`
            : command.label,
          description: command.description,
        })
      }
    }
    return result
  }

  const toolbarCommands = computed<PluginMenuCommand[]>(() =>
    menuCommandsForLocation(TOOLBAR_ACTIONS_LOCATION),
  )

  const commitContextCommands = computed<PluginMenuCommand[]>(() =>
    menuCommandsForLocation(COMMIT_CONTEXT_LOCATION),
  )

  async function load() {
    loading.value = true
    error.value = null
    try {
      plugins.value = await git.listPlugins()
      loaded.value = true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      loading.value = false
    }
  }

  async function installFromPath(path: string): Promise<boolean> {
    const installed = await git.installPluginFromPath(path)
    const idx = plugins.value.findIndex(
      (plugin) => plugin.manifest.id === installed.manifest.id,
    )
    if (idx >= 0) plugins.value[idx] = installed
    else plugins.value.push(installed)
    return idx >= 0
  }

  async function enable(pluginId: string) {
    await git.enablePlugin(pluginId)
    await load()
  }

  async function disable(pluginId: string) {
    await git.disablePlugin(pluginId)
    await load()
  }

  async function uninstall(pluginId: string) {
    await git.uninstallPlugin(pluginId)
    plugins.value = plugins.value.filter(
      (plugin) => plugin.manifest.id !== pluginId,
    )
  }

  async function execute(
    pluginId: string,
    commandId: string,
    context?: PluginCommandContext,
  ): Promise<PluginCommandResult> {
    const key = `${pluginId}:${commandId}`
    executing.value = key
    try {
      const repoStore = useRepoStore()
      const activeRepo = repoStore.activeRepo()
      return await git.executePluginCommand(pluginId, commandId, {
        repo_id: context?.repo_id ?? activeRepo?.id,
        repo_path: context?.repo_path ?? activeRepo?.path,
        selection: context?.selection ?? null,
      })
    } finally {
      executing.value = null
    }
  }

  return {
    plugins,
    loading,
    executing,
    error,
    loaded,
    enabledPlugins,
    toolbarCommands,
    commitContextCommands,
    load,
    installFromPath,
    enable,
    disable,
    uninstall,
    execute,
  }
})
