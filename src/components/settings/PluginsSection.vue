<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { useI18n } from 'vue-i18n'
import { usePluginsStore } from '@/stores/plugins'
import { useGlobalToast } from '@/composables/useGlobalToast'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import type { PluginInfo, PluginPermission } from '@/types/plugin'

const pluginsStore = usePluginsStore()
const { t } = useI18n()
const { showToast, showError, showActionError } = useGlobalToast()
const pendingUninstall = ref<{
  id: string
  name: string
  version: string
  path: string
} | null>(null)
const uninstalling = ref(false)
const installing = ref(false)

const sortedPlugins = computed(() =>
  [...pluginsStore.plugins].sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name),
  ),
)

onMounted(() => {
  if (!pluginsStore.loaded) {
    pluginsStore.load().catch(() => {})
  }
})

async function onInstall() {
  if (installing.value) return
  installing.value = true
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('settings.plugins.installTitle'),
    })
    if (typeof selected !== 'string') return
    const replaced = await pluginsStore.installFromPath(selected)
    showToast(
      'success',
      t(
        replaced
          ? 'settings.plugins.updateSuccess'
          : 'settings.plugins.installSuccess',
      ),
    )
  } catch (error) {
    showActionError(error)
  } finally {
    installing.value = false
  }
}

async function onToggle(plugin: PluginInfo) {
  if (plugin.enabled) await pluginsStore.disable(plugin.manifest.id)
  else await pluginsStore.enable(plugin.manifest.id)
}

function onUninstall(plugin: PluginInfo) {
  pendingUninstall.value = {
    id: plugin.manifest.id,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    path: plugin.path,
  }
}

function uninstallTargetIsCurrent(): boolean {
  const pending = pendingUninstall.value
  if (!pending) return false
  return pluginsStore.plugins.some((plugin) =>
    plugin.manifest.id === pending.id &&
    plugin.manifest.name === pending.name &&
    plugin.manifest.version === pending.version &&
    plugin.path === pending.path,
  )
}

async function onConfirmUninstall() {
  const pending = pendingUninstall.value
  if (!pending || uninstalling.value) return
  if (!uninstallTargetIsCurrent()) {
    pendingUninstall.value = null
    showError(t('settings.plugins.uninstallContextChanged'))
    return
  }
  uninstalling.value = true
  try {
    await pluginsStore.uninstall(pending.id)
    showToast('success', t('settings.plugins.uninstallSuccess'))
    pendingUninstall.value = null
  } catch (error) {
    showActionError(error)
  } finally {
    uninstalling.value = false
  }
}

function commandCount(plugin: PluginInfo): number {
  return plugin.manifest.contributes.commands.length
}

function menuCount(plugin: PluginInfo): number {
  return plugin.manifest.contributes.menus.length
}

function permissionId(permission: PluginPermission): string {
  return typeof permission === 'string' ? permission : permission.id
}

function permissionReason(permission: PluginPermission): string | undefined {
  return typeof permission === 'string' ? undefined : permission.reason
}
</script>

<template>
  <div class="section">
    <div class="section-title">
      <div>
        <div class="section-heading">{{ t('settings.plugins.title') }}</div>
        <div class="section-hint">{{ t('settings.plugins.hint') }}</div>
      </div>
      <div class="section-actions">
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="pluginsStore.loading || installing || uninstalling"
          @click="pluginsStore.load()"
        >
          {{ t('settings.plugins.refresh') }}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="pluginsStore.loading || installing || uninstalling"
          @click="onInstall"
        >
          {{
            installing
              ? t('settings.plugins.installing')
              : t('settings.plugins.install')
          }}
        </button>
      </div>
    </div>

    <div v-if="pluginsStore.error" class="error-box">
      {{ pluginsStore.error }}
    </div>

    <div v-if="pluginsStore.loading && sortedPlugins.length === 0" class="empty">
      {{ t('common.loading') }}
    </div>
    <div v-else-if="sortedPlugins.length === 0" class="empty">
      {{ t('settings.plugins.empty') }}
    </div>
    <div v-else class="plugin-list">
      <article
        v-for="plugin in sortedPlugins"
        :key="plugin.manifest.id"
        class="plugin-card"
      >
        <div class="plugin-main">
          <div class="plugin-title-row">
            <div class="plugin-name">{{ plugin.manifest.name }}</div>
            <span class="plugin-version">v{{ plugin.manifest.version }}</span>
            <span
              class="plugin-state"
              :class="{ 'plugin-state--enabled': plugin.enabled }"
            >
              {{ plugin.enabled ? t('settings.plugins.enabled') : t('settings.plugins.disabled') }}
            </span>
          </div>
          <div class="plugin-id">{{ plugin.manifest.id }}</div>
          <p v-if="plugin.manifest.description" class="plugin-desc">
            {{ plugin.manifest.description }}
          </p>
          <div class="plugin-meta">
            <span>{{ t('settings.plugins.commands', { count: commandCount(plugin) }) }}</span>
            <span>{{ t('settings.plugins.menus', { count: menuCount(plugin) }) }}</span>
            <span>{{ plugin.path }}</span>
          </div>
          <div
            v-if="plugin.manifest.permissions.length > 0"
            class="permission-list"
          >
            <span
              v-for="permission in plugin.manifest.permissions"
              :key="permissionId(permission)"
              class="permission-chip"
              :title="permissionReason(permission)"
            >
              {{ permissionId(permission) }}
            </span>
          </div>
        </div>
        <div class="plugin-actions">
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="pluginsStore.loading || uninstalling"
            @click="onToggle(plugin)"
          >
            {{ plugin.enabled ? t('settings.plugins.disable') : t('settings.plugins.enable') }}
          </button>
          <button
            type="button"
            class="btn btn-danger"
            :disabled="pluginsStore.loading || uninstalling"
            @click="onUninstall(plugin)"
          >
            {{ uninstalling && pendingUninstall?.id === plugin.manifest.id
              ? t('settings.plugins.uninstalling')
              : t('common.delete') }}
          </button>
        </div>
      </article>
    </div>

    <ConfirmDialog
      :visible="pendingUninstall !== null"
      :title="t('settings.plugins.confirmUninstallTitle')"
      :message="pendingUninstall
        ? t('settings.plugins.confirmUninstall', {
            name: pendingUninstall.name,
            version: pendingUninstall.version,
            id: pendingUninstall.id,
            path: pendingUninstall.path,
          })
        : ''"
      :confirm-label="t('settings.plugins.uninstall')"
      :loading-label="t('settings.plugins.uninstalling')"
      :danger="true"
      :loading="uninstalling"
      @confirm="onConfirmUninstall"
      @cancel="pendingUninstall = null"
    />
  </div>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.section-heading {
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--text-primary);
}

.section-hint {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: var(--font-sm);
  line-height: 1.4;
}

.section-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.empty,
.error-box {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px;
  color: var(--text-muted);
  background: var(--bg-surface);
}

.error-box {
  color: var(--accent-red);
  border-color: color-mix(in srgb, var(--accent-red) 35%, var(--border));
}

.plugin-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.plugin-card {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  background: var(--bg-surface);
}

.plugin-main {
  min-width: 0;
}

.plugin-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.plugin-name {
  color: var(--text-primary);
  font-weight: 600;
}

.plugin-version,
.plugin-state,
.permission-chip {
  color: var(--text-muted);
  font-size: var(--font-xs);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 6px;
}

.plugin-state--enabled {
  color: var(--accent-green);
  border-color: color-mix(in srgb, var(--accent-green) 35%, var(--border));
}

.plugin-id {
  margin-top: 4px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-xs);
}

.plugin-desc {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  line-height: 1.4;
}

.plugin-meta {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.permission-list {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.plugin-actions {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-shrink: 0;
}

.btn {
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 6px 10px;
  font-family: inherit;
  font-size: var(--font-sm);
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent-blue);
  border-color: var(--accent-blue);
  color: white;
}

.btn-secondary {
  background: var(--bg-overlay);
  color: var(--text-secondary);
}

.btn-danger {
  background: transparent;
  color: var(--accent-red);
  border-color: color-mix(in srgb, var(--accent-red) 35%, var(--border));
}
</style>
