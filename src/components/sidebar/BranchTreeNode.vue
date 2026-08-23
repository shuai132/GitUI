<script setup lang="ts">
import type { BranchTreeNode } from '@/utils/branchTree'
import type { BranchInfo } from '@/types/git'
import { useBranchTreeState } from '@/composables/useBranchTreeState'

const props = defineProps<{
  node: BranchTreeNode
  level: number
  /** 仅顶层 remote folder（remote name 行）传 true，用于显示删除按钮 */
  isRemoteRoot?: boolean
  currentUpstream?: string
  showLocalStatus?: boolean
  soloCurrentBranch?: boolean
  forceExpanded?: boolean
}>()

const emit = defineEmits<{
  selectBranch: [branch: BranchInfo]
  dblclickBranch: [branch: BranchInfo]
  branchContextMenu: [event: MouseEvent, branch: BranchInfo]
  deleteRemote: [remoteName: string]
  remoteContextMenu: [event: MouseEvent, remoteName: string]
}>()

const treeState = useBranchTreeState()

function onFolderClick() {
  if (props.node.kind !== 'folder') return
  treeState.toggle(props.node.path)
}

function onBranchClick() {
  if (props.node.kind !== 'branch') return
  emit('selectBranch', props.node.branch)
}

function onBranchDblclick() {
  if (props.node.kind !== 'branch') return
  emit('dblclickBranch', props.node.branch)
}

function onBranchContextMenu(e: MouseEvent) {
  if (props.node.kind !== 'branch') return
  e.preventDefault()
  emit('branchContextMenu', e, props.node.branch)
}

function onDeleteRemote(e: MouseEvent) {
  e.stopPropagation()
  if (props.node.kind !== 'folder') return
  emit('deleteRemote', props.node.name)
}

function onFolderContextMenu(e: MouseEvent) {
  if (props.node.kind !== 'folder') return
  if (props.isRemoteRoot) {
    e.preventDefault()
    e.stopPropagation()
    emit('remoteContextMenu', e, props.node.name)
  }
}

function hasAheadBehind(branch: BranchInfo): boolean {
  return (branch.ahead ?? 0) > 0 || (branch.behind ?? 0) > 0
}

function showSoloBadge(branch: BranchInfo): boolean {
  return !!props.showLocalStatus && !!props.soloCurrentBranch && branch.is_head && branch.name !== 'HEAD'
}

// 缩进：level=0 与 section-title 的 padding-left (12px) 对齐，
// 之后每层再缩进 12px
const indentPx = (level: number) => 12 + level * 12 + 'px'
</script>

<template>
  <!-- Folder 节点 -->
  <template v-if="node.kind === 'folder'">
    <div
      class="tree-row tree-folder"
      :class="{ 'tree-folder--remote-root': isRemoteRoot }"
      :style="{ paddingLeft: indentPx(level) }"
      @contextmenu="onFolderContextMenu"
    >
      <button
        type="button"
        class="tree-row-action"
        :aria-expanded="forceExpanded || !treeState.isCollapsed(node.path)"
        @click="onFolderClick"
      >
        <svg
          class="chevron"
          :class="{ open: forceExpanded || !treeState.isCollapsed(node.path) }"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <svg class="folder-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="tree-label">{{ node.name }}</span>
      </button>
      <!-- 顶层 remote folder：悬停时显示删除按钮 -->
      <button
        v-if="isRemoteRoot"
        type="button"
        class="remote-delete-btn"
        :title="`Remove remote '${node.name}'`"
        :aria-label="`Remove remote '${node.name}'`"
        @click.stop="onDeleteRemote"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <template v-if="forceExpanded || !treeState.isCollapsed(node.path)">
      <BranchTreeNode
        v-for="child in node.children"
        :key="child.kind === 'folder' ? 'f:' + child.path : 'b:' + child.fullName"
        :node="child"
        :level="level + 1"
        :current-upstream="currentUpstream"
        :show-local-status="showLocalStatus"
        :solo-current-branch="soloCurrentBranch"
        :force-expanded="forceExpanded"
        @select-branch="(b) => emit('selectBranch', b)"
        @dblclick-branch="(b) => emit('dblclickBranch', b)"
        @branch-context-menu="(ev, b) => emit('branchContextMenu', ev, b)"
        @delete-remote="(n) => emit('deleteRemote', n)"
        @remote-context-menu="(ev, n) => emit('remoteContextMenu', ev, n)"
      />
    </template>
  </template>

  <!-- Branch 叶子节点 -->
  <template v-else>
    <button
      type="button"
      class="tree-row tree-branch"
      :class="{
        'tree-branch--current': node.branch.is_head,
        'tree-branch--upstream': currentUpstream && node.branch.name === currentUpstream
      }"
      :style="{ paddingLeft: indentPx(level) }"
      :title="node.fullName"
      @click="onBranchClick"
      @dblclick.stop="onBranchDblclick"
      @contextmenu="onBranchContextMenu"
    >
      <span
        class="branch-dot"
        :class="{
          'dot-solid': node.branch.is_head,
          'dot-outline': !node.branch.is_head,
          'dot-remote': node.branch.is_remote,
        }"
      />
      <span class="tree-label">{{ node.name }}</span>
      <span v-if="showSoloBadge(node.branch)" class="solo-badge">SOLO</span>
      <span v-if="showLocalStatus && hasAheadBehind(node.branch)" class="ahead-behind">
        <span v-if="(node.branch.ahead ?? 0) > 0" class="ab-ahead">↑{{ node.branch.ahead }}</span>
        <span v-if="(node.branch.behind ?? 0) > 0" class="ab-behind">↓{{ node.branch.behind }}</span>
      </span>
    </button>
  </template>
</template>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 10px;
  padding-top: 3px;
  padding-bottom: 3px;
  font-size: var(--font-md);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s;
  user-select: none;
  width: 100%;
  box-sizing: border-box;
  border: none;
  background: transparent;
  font: inherit;
  text-align: left;
}

.tree-row:hover {
  background: var(--bg-overlay);
}

.tree-folder {
  color: var(--text-muted);
}

.tree-folder:hover {
  color: var(--text-secondary);
}

.tree-row-action {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  align-self: stretch;
  gap: 6px;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tree-row:focus-visible,
.tree-row-action:focus-visible,
.remote-delete-btn:focus-visible {
  outline: 1px solid var(--accent-blue);
  outline-offset: -1px;
}

.tree-branch--current,
.tree-branch--upstream {
  color: var(--accent-blue);
  background: var(--bg-overlay);
  font-weight: 500;
}

.chevron {
  transition: transform 0.15s;
  transform: rotate(0deg);
  flex-shrink: 0;
  color: var(--text-muted);
}

.chevron.open {
  transform: rotate(90deg);
}

.folder-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.branch-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  /* 让 dot 位置与 folder 的 chevron+icon 对齐 */
  margin-left: 14px;
}

.dot-solid {
  background: var(--accent-blue);
}

.dot-outline {
  border: 1.5px solid var(--text-muted);
}

.dot-remote {
  border-color: var(--accent-orange);
  opacity: 0.75;
}

.tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.ahead-behind {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-xs);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  background: var(--bg-overlay);
  padding: 1px 5px;
  border-radius: 7px;
  line-height: 1.4;
}

.solo-badge {
  flex-shrink: 0;
  border: 1px solid color-mix(in srgb, var(--accent-blue) 35%, transparent);
  border-radius: 3px;
  padding: 0 3px;
  font-size: 9px;
  font-weight: 600;
  line-height: 1.25;
  color: color-mix(in srgb, var(--accent-blue) 82%, var(--fg-muted));
  background: color-mix(in srgb, var(--accent-blue) 8%, transparent);
  letter-spacing: 0;
}

.ab-ahead {
  color: var(--accent-green);
}

.ab-behind {
  color: var(--accent-orange);
}

/* 顶层 remote folder 的删除按钮：默认隐藏，hover 时显示 */
.remote-delete-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 3px;
  border-radius: 3px;
  color: var(--text-muted);
  flex-shrink: 0;
  line-height: 0;
  opacity: 0;
  pointer-events: none;
}

.tree-folder--remote-root:hover .remote-delete-btn,
.tree-folder--remote-root:focus-within .remote-delete-btn {
  opacity: 1;
  pointer-events: auto;
}

.remote-delete-btn:hover {
  background: rgba(237, 135, 150, 0.18);
  color: var(--accent-red);
}
</style>
