<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppToolbar from '@/components/layout/AppToolbar.vue'
import AppStatusBar from '@/components/layout/AppStatusBar.vue'
import DebugPanel from '@/components/debug/DebugPanel.vue'
import TerminalPanel from '@/components/terminal/TerminalPanel.vue'
import ContextMenu from '@/components/common/ContextMenu.vue'
import CloneRepoDialog from '@/components/repo/CloneRepoDialog.vue'
import InitRepoDialog from '@/components/repo/InitRepoDialog.vue'
import { useRepoCreation } from '@/composables/useRepoCreation'
import { usePickRemote } from '@/composables/usePickRemote'
import { useRepoStore } from '@/stores/repos'
import { useWorkspaceStore } from '@/stores/workspace'
import { useHistoryStore } from '@/stores/history'
import { useSubmodulesStore } from '@/stores/submodules'
import { useStashStore } from '@/stores/stash'
import { useDiffStore } from '@/stores/diff'
import { useUiStore } from '@/stores/ui'
import { useDebugStore } from '@/stores/debug'
import { useGitEvents } from '@/composables/useGitEvents'
import { useGitCommands } from '@/composables/useGitCommands'
import { listen } from '@tauri-apps/api/event'

const { t } = useI18n()
const router = useRouter()
const repoStore = useRepoStore()
const workspaceStore = useWorkspaceStore()
const historyStore = useHistoryStore()
const submodulesStore = useSubmodulesStore()
const stashStore = useStashStore()
const diffStore = useDiffStore()
const uiStore = useUiStore()
const debugStore = useDebugStore()
const { onStatusChanged } = useGitEvents()
const git = useGitCommands()

// 「添加仓库」下拉菜单 + clone/init 对话框：菜单和对话框都挂在 App 顶层，
// AppToolbar/AppSidebar 通过 useRepoCreation() 触发显示。
// destructure 出顶级 ref，让模板自动 unwrap，避免嵌套 ref.value 的响应式坑
const {
  menuVisible: repoMenuVisible,
  menuX: repoMenuX,
  menuY: repoMenuY,
  cloneDialogVisible,
  initDialogVisible,
  hideMenu: repoHideMenu,
  openCloneDialog,
  openInitDialog,
  closeCloneDialog,
  closeInitDialog,
} = useRepoCreation()

// 选 remote 的全局菜单：sidebar push tag 等场景复用
const {
  menuVisible: pickRemoteVisible,
  menuX: pickRemoteX,
  menuY: pickRemoteY,
  menuItems: pickRemoteItems,
  onMenuSelect: onPickRemoteSelect,
  onMenuClose: onPickRemoteClose,
} = usePickRemote()

const repoCreationItems = computed(() => [
  { label: t('repo.menu.open'), action: 'open' },
  { label: t('repo.menu.clone'), action: 'clone' },
  { label: t('repo.menu.init'), action: 'init' },
])

async function onRepoCreationSelect(action: string) {
  if (action === 'open') {
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
      const selected = await openDialog({ directory: true })
      if (typeof selected === 'string') {
        await repoStore.openRepo(selected)
      }
    } catch (e) {
      console.error(e)
    }
  } else if (action === 'clone') {
    openCloneDialog()
  } else if (action === 'init') {
    openInitDialog()
  }
}

// 启动时从持久化存储恢复仓库列表；之后取一次由父进程通过 `--open-repo`
// 注入的启动仓库路径（在新窗口中打开某仓库的场景），存在则 openRepo 激活它。
onMounted(async () => {
  await repoStore.loadPersisted()
  try {
    const path = await git.consumeStartupRepo()
    if (path) {
      await repoStore.openRepo(path)
    }
  } catch (e) {
    console.error(e)
  }
})

// 监听 Rust 后端日志事件
listen<{ level: string; target: string; message: string; ts: number }>(
  'repo://log',
  (event) => {
    debugStore.pushLog(
      event.payload.level,
      event.payload.target,
      event.payload.message,
      event.payload.ts,
    )
  },
)

// ── Sidebar width (可拖动，支持拖到 0 完全隐藏) ──────────────────────
// 持久化由 uiStore 托管，这里只负责拖动期间的响应式更新
// 吸附规则：<30px 吸附到 0（隐藏），[30, 60) 吸附到 60（最小可用宽度）
const SIDEBAR_MIN = 60
const SIDEBAR_MAX = 480
const SIDEBAR_SNAP = 30
const SIDEBAR_DEFAULT = 220

function startSidebarResize(e: PointerEvent) {
  e.preventDefault()
  const startX = e.clientX
  const startW = uiStore.sidebarWidth
  let moved = false
  const onMove = (ev: PointerEvent) => {
    if (Math.abs(ev.clientX - startX) > 2) moved = true
    const raw = startW + (ev.clientX - startX)
    let next: number
    if (raw < SIDEBAR_SNAP) next = 0
    else if (raw < SIDEBAR_MIN) next = SIDEBAR_MIN
    else next = Math.min(SIDEBAR_MAX, raw)
    uiStore.sidebarWidth = next
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    uiStore.persistSidebarWidth()
    // 未拖动（点击）：不做任何事，双击 handler 单独处理切换
    void moved
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

// 双击分割条：在"隐藏"和"默认宽度"之间切换
function toggleSidebar() {
  uiStore.sidebarWidth = uiStore.sidebarWidth === 0 ? SIDEBAR_DEFAULT : 0
  uiStore.persistSidebarWidth()
}

// Listen for file system changes and refresh status
onStatusChanged((repoId) => {
  if (repoId === repoStore.activeRepoId) {
    workspaceStore.refresh(repoId)
    submodulesStore.loadSubmodules()
    // WIP 模式下右侧 diff 也要跟着工作区内容自动刷新；
    // diffStore.refresh 在 currentPath === null 时是 no-op，非 WIP 场景安全。
    diffStore.refresh()
    // 外部 git 操作（命令行 commit/push/fetch/switch/stash 等）也会触发此事件，
    // 需要同步刷新 history、branches 和 stash
    historyStore.loadLog()
    historyStore.loadBranches()
    historyStore.loadTags()
    stashStore.refresh()
  }
})

// Terminal 面板 mount-once：首次显示后一直保留在 DOM 里，
// 通过 v-show 切换显隐，避免隐藏时销毁 xterm 实例 + pty 会话，
// 下次展开能保留输出内容。
const terminalEverMounted = ref(uiStore.terminalVisible)
watch(
  () => uiStore.terminalVisible,
  (v) => {
    if (v) terminalEverMounted.value = true
  },
)

// Refresh workspace when active repo changes
watch(
  () => repoStore.activeRepoId,
  async (id) => {
    if (id) {
      router.push('/history')
      await workspaceStore.refresh(id)
      await historyStore.loadLog()
      await historyStore.loadBranches()
      await historyStore.loadTags()
      await submodulesStore.loadSubmodules()
      await stashStore.refresh()
      // 远端 tag 同步状态独立于以上数据源，走网络，失败静默
      historyStore.loadRemoteTags().catch(() => {})
    } else {
      submodulesStore.reset()
      stashStore.reset()
    }
  }
)
</script>

<template>
  <div class="app-layout">
    <AppToolbar />
    <div class="app-body">
      <AppSidebar :style="{ width: uiStore.sidebarWidth + 'px' }" />
      <div
        class="sidebar-resize"
        :class="{ 'sidebar-resize-collapsed': uiStore.sidebarWidth === 0 }"
        :title="uiStore.sidebarWidth === 0 ? t('app.sidebar.expandHint') : t('app.sidebar.resizeHint')"
        @pointerdown="startSidebarResize"
        @dblclick="toggleSidebar"
      />
      <main class="app-main">
        <div class="main-with-terminal" :data-dock="uiStore.terminalDock">
          <div class="main-content"><RouterView /></div>
          <TerminalPanel
            v-if="terminalEverMounted"
            v-show="uiStore.terminalVisible"
            :style="uiStore.terminalDock === 'bottom'
              ? { height: uiStore.terminalHeight + 'px' }
              : { width: uiStore.terminalWidth + 'px' }"
          />
        </div>
      </main>
      <DebugPanel v-if="uiStore.debugPanelVisible" />
    </div>
    <AppStatusBar />

    <!-- 全局：添加仓库菜单 + clone/init 对话框 -->
    <ContextMenu
      :visible="repoMenuVisible"
      :x="repoMenuX"
      :y="repoMenuY"
      :items="repoCreationItems"
      @close="repoHideMenu"
      @select="onRepoCreationSelect"
    />
    <CloneRepoDialog
      :visible="cloneDialogVisible"
      @close="closeCloneDialog"
    />
    <InitRepoDialog
      :visible="initDialogVisible"
      @close="closeInitDialog"
    />
    <!-- 选 remote（多 remote 弹菜单） -->
    <ContextMenu
      :visible="pickRemoteVisible"
      :x="pickRemoteX"
      :y="pickRemoteY"
      :items="pickRemoteItems"
      @close="onPickRemoteClose"
      @select="onPickRemoteSelect"
    />
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-primary);
}

.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.app-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Terminal 停靠容器：bottom 时垂直堆叠，right 时水平并排 */
.main-with-terminal {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.main-with-terminal[data-dock="bottom"] {
  flex-direction: column;
}
.main-with-terminal[data-dock="right"] {
  flex-direction: row;
}
.main-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Sidebar resize handle: 覆盖在 sidebar 右边界上 */
.sidebar-resize {
  width: 6px;
  margin-left: -3px;
  cursor: col-resize;
  flex-shrink: 0;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;
}
.sidebar-resize:hover,
.sidebar-resize:active {
  background: rgba(138, 173, 244, 0.3);
}
/* sidebar 隐藏时，handle 贴左边缘显示，不向左偏移，确保完全可见 */
.sidebar-resize-collapsed {
  margin-left: 0;
  background: var(--border);
}
.sidebar-resize-collapsed:hover,
.sidebar-resize-collapsed:active {
  background: rgba(138, 173, 244, 0.5);
}
</style>
