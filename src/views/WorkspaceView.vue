<script setup lang="ts">
import { watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDiffStore } from '@/stores/diff'
import { useRepoStore } from '@/stores/repos'
import FileChangeList from '@/components/workspace/FileChangeList.vue'
import CommitPanel from '@/components/workspace/CommitPanel.vue'
import DiffViewer from '@/components/diff/DiffViewer.vue'
import type { FileEntry } from '@/types/git'

const workspaceStore = useWorkspaceStore()
const diffStore = useDiffStore()
const repoStore = useRepoStore()

function onSelectFile(file: FileEntry) {
  workspaceStore.selectFile(file)
  diffStore.loadFileDiff(file.path, file.staged)
}

function onToggleFile(file: FileEntry) {
  if (file.staged) {
    workspaceStore.unstageFile(file.path)
  } else {
    workspaceStore.stageFile(file.path)
  }
}
</script>

<template>
  <div class="workspace-view">
    <div v-if="!repoStore.activeRepoId" class="no-repo">
      <div class="no-repo-content">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.3">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        <p>从左侧打开一个 Git 仓库</p>
      </div>
    </div>

    <template v-else>
      <!-- Left panel: file changes -->
      <div class="panel-left">
        <div class="changes-container">
          <FileChangeList
            :files="workspaceStore.status?.staged ?? []"
            title="已暂存"
            empty-text="无暂存文件"
            @select="onSelectFile"
            @toggle="onToggleFile"
            @toggle-all="workspaceStore.unstageAll()"
          />
          <FileChangeList
            :files="workspaceStore.status?.unstaged ?? []"
            title="未暂存"
            empty-text="无未暂存变更"
            @select="onSelectFile"
            @toggle="onToggleFile"
            @toggle-all="workspaceStore.stageAll()"
          />
          <FileChangeList
            :files="workspaceStore.status?.untracked ?? []"
            title="未跟踪"
            empty-text="无未跟踪文件"
            @select="onSelectFile"
            @toggle="onToggleFile"
            @toggle-all="() => {}"
          />
        </div>
        <CommitPanel />
      </div>

      <!-- Right panel: diff viewer -->
      <div class="panel-right">
        <DiffViewer
          :diff="diffStore.currentDiff"
          :loading="diffStore.loading"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.workspace-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.no-repo {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.no-repo-content {
  text-align: center;
  color: var(--text-muted);
}

.no-repo-content p {
  margin-top: 12px;
  font-size: 13px;
}

.panel-left {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.changes-container {
  flex: 1;
  overflow-y: auto;
}

.panel-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
