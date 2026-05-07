<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommitDetail } from '@/types/git'
import { formatAbsoluteTime } from '@/utils/format'
import { GRAPH_COLORS } from '@/utils/graph'
import { useUiStore } from '@/stores/ui'
import { useRepoStore } from '@/stores/repos'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSubmodulesStore } from '@/stores/submodules'
import { useGitCommands } from '@/composables/useGitCommands'
import { useHistoryStore } from '@/stores/history'
import { useCommitFileMenu } from '@/composables/history/useCommitFileMenu'
import ContextMenu from '@/components/common/ContextMenu.vue'
import CommitFileList from '@/components/history/CommitFileList.vue'
import type { SubmoduleInfo } from '@/types/git'

const { t } = useI18n()
const historyStore = useHistoryStore()
const uiStore = useUiStore()

const props = defineProps<{
  commit: CommitDetail | null
  selectedFileIdx: number
}>()

const emit = defineEmits<{
  selectFile: [idx: number]
  showFileHistory: [payload: { filePath: string; mode: 'history' | 'blame' }]
}>()

const repoStore = useRepoStore()
const workspaceStore = useWorkspaceStore()
const submodulesStore = useSubmodulesStore()
const git = useGitCommands()
const sizes = uiStore.historyPaneSizes

const filesFirst = computed(() => uiStore.detailFilesFirst)

// ── 头部区（summary + meta-grid）和变动文件列表之间的可拖拽分隔条 ──
const panelRoot = ref<HTMLElement | null>(null)
const topSection = ref<HTMLElement | null>(null)

const topSectionStyle = computed(() => {
  return sizes.commitInfoTopH > 0
    ? { height: sizes.commitInfoTopH + 'px' }
    : { maxHeight: '65%' }
})

function startTopResize(e: PointerEvent) {
  e.preventDefault()
  const topEl = topSection.value
  const rootEl = panelRoot.value
  if (!topEl || !rootEl) return
  const startY = e.clientY
  const startH = topEl.getBoundingClientRect().height
  const rootH = rootEl.getBoundingClientRect().height
  const maxH = Math.max(80, rootH - 80)
  const dir = filesFirst.value ? -1 : 1
  const onMove = (ev: PointerEvent) => {
    const next = startH + dir * (ev.clientY - startY)
    sizes.commitInfoTopH = Math.max(60, Math.min(maxH, next))
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    uiStore.persistHistoryPaneSizes()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}

const initials = computed(() => {
  const name = props.commit?.info.author_name ?? ''
  return name
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('')
})

const avatarColor = computed(() => {
  const name = props.commit?.info.author_name ?? ''
  let hash = 0
  for (const c of name) hash = ((hash * 31) + c.charCodeAt(0)) & 0x7fffffff
  return GRAPH_COLORS[hash % GRAPH_COLORS.length]
})

const bodyText = computed(() => {
  const msg = props.commit?.info.message ?? ''
  const firstLine = msg.indexOf('\n')
  return firstLine !== -1 ? msg.slice(firstLine + 1).trim() : ''
})

// ── 文件右键菜单 ─────────────────────────────────────────────────
const commitDiffs = computed(() => props.commit?.diffs ?? [])
const commitOid = computed(() => props.commit?.info.oid)
const submodulePaths = computed(() => submodulesStore.submodules.map((submodule) => submodule.path))

async function openSubmoduleFromHistory(submodule: SubmoduleInfo) {
  try {
    const absPath = await submodulesStore.workdir(submodule.name)
    await repoStore.openRepo(absPath)
  } catch (err) {
    console.error(err)
    alert(t('sidebar.submodule.openFailed', { detail: String(err) }))
  }
}

const {
  fileMenu,
  fileMenuItems,
  openFileMenu,
  handleFileMenuAction,
} = useCommitFileMenu({
  t,
  git,
  repoStore,
  workspaceStore,
  submodules: computed(() => submodulesStore.submodules),
  diffs: commitDiffs,
  commitOid,
  openSubmodule: openSubmoduleFromHistory,
  showFileHistory: (payload) => emit('showFileHistory', payload),
})
</script>

<template>
  <div class="commit-info-panel" v-if="commit" ref="panelRoot">
    <!-- 上半区：头部 + 元数据 -->
    <div
      class="top-section"
      ref="topSection"
      :style="[topSectionStyle, filesFirst ? { order: 2 } : {}]"
    >
      <div class="panel-header">
        <div class="avatar" :style="{ background: avatarColor }">{{ initials }}</div>
        <div class="title-block">
          <div class="commit-summary">{{ commit.info.summary }}</div>
          <div class="commit-body" v-if="bodyText">{{ bodyText }}</div>
        </div>
      </div>

      <div class="meta-grid">
        <span class="mk">{{ t('history.detailsPanel.commit') }}</span>
        <span class="mv oid">{{ commit.info.oid.slice(0, 16) }}</span>

        <span class="mk">{{ t('history.detailsPanel.author') }}</span>
        <span class="mv">{{ commit.info.author_name }}</span>

        <span class="mk">{{ t('history.detailsPanel.date') }}</span>
        <span class="mv">{{ formatAbsoluteTime(commit.info.time) }}</span>

        <span class="mk">{{ t('history.detailsPanel.email') }}</span>
        <span class="mv dim">{{ commit.info.author_email }}</span>

        <template v-if="commit.info.parent_oids.length">
          <span class="mk">{{ t('history.detailsPanel.parents') }}</span>
          <span class="mv">
            <span
              v-for="p in commit.info.parent_oids"
              :key="p"
              class="parent-chip"
            >{{ p.slice(0, 7) }}</span>
          </span>
        </template>
      </div>
    </div>

    <div
      v-if="commit.diffs.length || historyStore.loadingDetail"
      class="top-resize"
      :style="filesFirst ? { order: 1 } : {}"
      @pointerdown="startTopResize"
    />

    <CommitFileList
      :style="filesFirst ? { order: 0 } : {}"
      v-if="commit.diffs.length || historyStore.loadingDetail"
      :diffs="commit.diffs"
      :commit-oid="commit.info.oid"
      :selected-file-idx="selectedFileIdx"
      :submodule-paths="submodulePaths"
      :loading="historyStore.loadingDetail"
      @select-file="emit('selectFile', $event)"
      @file-context-menu="openFileMenu"
    />
  </div>

  <div v-else class="panel-empty">{{ t('history.detailsPanel.empty') }}</div>

  <ContextMenu
    :visible="fileMenu.visible"
    :x="fileMenu.x"
    :y="fileMenu.y"
    :items="fileMenuItems"
    @close="fileMenu.visible = false"
    @select="handleFileMenuAction"
  />
</template>

<style scoped>
.commit-info-panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  overflow: hidden;
  height: 100%;
}

/* 头部 + 元数据组合区：默认内容自适应高度，拖拽后变成固定像素高度 */
.top-section {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow-y: auto;
  min-height: 0;
}

.panel-header {
  display: flex;
  gap: 10px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  min-height: 0;
}

/* 盖过全局 * { user-select: none }：通配符直接给每个子元素设 none，
   单独给父元素设 text 不会继承，需要连子孙一起覆写。 */
.panel-header,
.panel-header *,
.meta-grid,
.meta-grid * {
  user-select: text;
  -webkit-user-select: text;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-base);
  font-weight: 700;
  color: var(--bg-primary);
  flex-shrink: 0;
}

.title-block {
  flex: 1;
  min-width: 0;
}

.commit-summary {
  font-size: var(--font-base);
  font-weight: 600;
  color: var(--text-primary);
  /* 超长标题改为水平滚动而非截断 */
  white-space: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
}

.commit-body {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  margin-top: 3px;
  /* 保留原始换行；长行自动折行；不独立滚动，由 top-section 统一处理 */
  white-space: pre-wrap;
  word-break: break-word;
  overflow: visible;
}

/* 隐藏滚动条（内容仍可滚动，但不显示指示条） */
.commit-summary,
.mv {
  scrollbar-width: none;
}
.commit-summary::-webkit-scrollbar,
.mv::-webkit-scrollbar {
  display: none;
}

.meta-grid {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 2px 8px;
  padding: 6px 12px;
  font-size: var(--font-sm);
  flex-shrink: 0;
}

/* top-section 与 file-tabs 之间的可拖拽分隔条 */
.top-resize {
  flex-shrink: 0;
  height: 4px;
  cursor: row-resize;
  background: transparent;
  border-top: 1px solid var(--border);
  position: relative;
  z-index: 2;
}
.top-resize:hover,
.top-resize:active {
  background: rgba(138, 173, 244, 0.15);
}

.mk {
  color: var(--text-muted);
  text-align: right;
  align-self: center;
  white-space: nowrap;
}

.mv {
  color: var(--text-primary);
  white-space: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  align-self: center;
  /* 最小高度保持行对齐，避免滚动条把行撑高 */
  min-width: 0;
}

.mv.oid {
  font-family: Menlo, 'SF Mono', monospace;
  font-size: var(--font-xs);
  color: var(--accent-blue);
}

.mv.dim {
  color: var(--text-secondary);
}

.parent-chip {
  display: inline-block;
  background: var(--bg-overlay);
  border-radius: 3px;
  padding: 1px 5px;
  font-family: Menlo, 'SF Mono', monospace;
  font-size: var(--font-xs);
  color: var(--accent-blue);
  margin-right: 4px;
  cursor: pointer;
}

.panel-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: var(--font-md);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}
</style>
