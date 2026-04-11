<script setup lang="ts">
import { computed } from 'vue'
import type { FileDiff, DiffLine } from '@/types/git'

const props = defineProps<{
  diff: FileDiff | null
  loading?: boolean
}>()

interface AlignedLine {
  lineNo?: number
  content: string
  kind: 'del' | 'add' | 'ctx' | 'empty' | 'header'
}

interface AlignedRow {
  left: AlignedLine
  right: AlignedLine
}

const alignedRows = computed((): AlignedRow[] => {
  if (!props.diff) return []
  const rows: AlignedRow[] = []

  for (const hunk of props.diff.hunks) {
    // Hunk header row
    rows.push({
      left: { content: hunk.header.trimEnd(), kind: 'header' },
      right: { content: '', kind: 'header' },
    })

    // Process lines within this hunk using a state machine
    let delBuf: DiffLine[] = []
    let addBuf: DiffLine[] = []

    function flushBuffers() {
      const maxLen = Math.max(delBuf.length, addBuf.length)
      for (let i = 0; i < maxLen; i++) {
        const dl = delBuf[i]
        const al = addBuf[i]
        rows.push({
          left: dl
            ? { lineNo: dl.old_lineno, content: dl.content.replace(/\n$/, ''), kind: 'del' }
            : { content: '', kind: 'empty' },
          right: al
            ? { lineNo: al.new_lineno, content: al.content.replace(/\n$/, ''), kind: 'add' }
            : { content: '', kind: 'empty' },
        })
      }
      delBuf = []
      addBuf = []
    }

    for (const line of hunk.lines) {
      if (line.origin === '-') {
        delBuf.push(line)
      } else if (line.origin === '+') {
        addBuf.push(line)
      } else {
        // Context line — flush pending del/add first
        flushBuffers()
        const content = line.content.replace(/\n$/, '')
        rows.push({
          left: { lineNo: line.old_lineno, content, kind: 'ctx' },
          right: { lineNo: line.new_lineno, content, kind: 'ctx' },
        })
      }
    }
    flushBuffers()
  }

  return rows
})

const filePath = computed(() => props.diff?.new_path ?? props.diff?.old_path ?? '')
</script>

<template>
  <div class="sbs-diff">
    <!-- Loading / empty states -->
    <div v-if="loading" class="sbs-state">加载中...</div>
    <div v-else-if="!diff" class="sbs-state">选择提交查看文件变更</div>
    <div v-else-if="diff.is_binary" class="sbs-state">二进制文件</div>
    <div v-else-if="diff.hunks.length === 0" class="sbs-state">无内容变更</div>

    <!-- Side-by-side content -->
    <template v-else>
      <div class="sbs-body">
        <!-- Left pane (old / deletions) -->
        <div class="sbs-pane">
          <div
            v-for="(row, i) in alignedRows"
            :key="'l' + i"
            class="diff-line"
            :class="'line-' + row.left.kind"
          >
            <span class="ln">{{ row.left.lineNo ?? '' }}</span>
            <span class="sign">{{ row.left.kind === 'del' ? '-' : row.left.kind === 'ctx' ? ' ' : '' }}</span>
            <span class="code">{{ row.left.content }}</span>
          </div>
        </div>

        <!-- Divider -->
        <div class="sbs-divider" />

        <!-- Right pane (new / additions) -->
        <div class="sbs-pane">
          <div
            v-for="(row, i) in alignedRows"
            :key="'r' + i"
            class="diff-line"
            :class="'line-' + row.right.kind"
          >
            <span class="ln">{{ row.right.lineNo ?? '' }}</span>
            <span class="sign">{{ row.right.kind === 'add' ? '+' : row.right.kind === 'ctx' ? ' ' : '' }}</span>
            <span class="code">{{ row.right.content }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sbs-diff {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
}

.sbs-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}

.sbs-body {
  flex: 1;
  display: flex;
  overflow: auto;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  line-height: 18px;
}

.sbs-pane {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.sbs-divider {
  width: 1px;
  background: var(--border);
  flex-shrink: 0;
}

.diff-line {
  display: flex;
  align-items: flex-start;
  white-space: pre;
  min-height: 18px;
}

.ln {
  width: 44px;
  text-align: right;
  padding-right: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
  user-select: none;
  font-size: 11px;
}

.sign {
  width: 16px;
  flex-shrink: 0;
  text-align: center;
  user-select: none;
}

.code {
  flex: 1;
  overflow: hidden;
  padding-right: 8px;
}

/* Line type backgrounds */
.line-del {
  background: rgba(237, 135, 150, 0.18);
}
.line-del .sign {
  color: var(--accent-red);
}

.line-add {
  background: rgba(166, 218, 149, 0.18);
}
.line-add .sign {
  color: var(--accent-green);
}

.line-empty {
  background: rgba(54, 58, 79, 0.4);
}

.line-header {
  background: var(--bg-surface);
  color: var(--text-muted);
  font-size: 11px;
}
.line-header .code {
  padding-left: 4px;
}

.line-ctx {
  color: var(--text-secondary);
}
</style>
