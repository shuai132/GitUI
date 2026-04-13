<script setup lang="ts">
import type { BranchTreeNode } from '@/utils/branchTree'
import type { BranchInfo } from '@/types/git'
import { useBranchTreeState } from '@/composables/useBranchTreeState'

const props = defineProps<{
  node: BranchTreeNode
  level: number
}>()

const emit = defineEmits<{
  selectBranch: [branch: BranchInfo]
  dblclickBranch: [branch: BranchInfo]
  branchContextMenu: [event: MouseEvent, branch: BranchInfo]
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

// 缩进：level=0 与 section-title 的 padding-left (12px) 对齐，
// 之后每层再缩进 12px
const indentPx = (level: number) => 12 + level * 12 + 'px'
</script>

<template>
  <!-- Folder 节点 -->
  <template v-if="node.kind === 'folder'">
    <div
      class="tree-row tree-folder"
      :style="{ paddingLeft: indentPx(level) }"
      @click="onFolderClick"
    >
      <svg
        class="chevron"
        :class="{ open: !treeState.isCollapsed(node.path) }"
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
    </div>

    <template v-if="!treeState.isCollapsed(node.path)">
      <BranchTreeNode
        v-for="child in node.children"
        :key="child.kind === 'folder' ? 'f:' + child.path : 'b:' + child.fullName"
        :node="child"
        :level="level + 1"
        @select-branch="(b) => emit('selectBranch', b)"
        @dblclick-branch="(b) => emit('dblclickBranch', b)"
        @branch-context-menu="(ev, b) => emit('branchContextMenu', ev, b)"
      />
    </template>
  </template>

  <!-- Branch 叶子节点 -->
  <template v-else>
    <div
      class="tree-row tree-branch"
      :class="{ 'tree-branch--current': node.branch.is_head }"
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
    </div>
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
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s;
  user-select: none;
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

.tree-branch--current {
  color: var(--text-primary);
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
</style>
