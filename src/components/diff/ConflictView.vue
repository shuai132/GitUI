<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConflictFile } from '@/types/git'
import { useMergeRebaseStore } from '@/stores/mergeRebase'
import { highlightLine, detectLangByPath } from '@/lib/highlight'
import { createVueSfcLineLangMap, isVuePath } from '@/lib/vueSfcHighlight'
import { buildConflictAlignment, buildConflictOutputMap } from '@/lib/conflictMerge'
import { useConflictSelection } from '@/composables/diff/useConflictSelection'
import { useSyncedConflictPanes } from '@/composables/diff/useSyncedConflictPanes'

const { t } = useI18n()

const props = defineProps<{
  repoId?: string
  filePath: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const mr = useMergeRebaseStore()

const conflict = ref<ConflictFile | null>(null)
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref<string | null>(null)
let loadRequestSeq = 0

async function load() {
  const requestSeq = ++loadRequestSeq
  const repoId = props.repoId
  const filePath = props.filePath
  if (!repoId || !filePath) {
    conflict.value = null
    loading.value = false
    return
  }
  loading.value = true
  errorMsg.value = null
  conflict.value = null
  try {
    const file = await mr.loadConflictFile(repoId, filePath)
    if (
      requestSeq !== loadRequestSeq ||
      props.repoId !== repoId ||
      props.filePath !== filePath
    ) return
    conflict.value = file
  } catch (e) {
    if (requestSeq !== loadRequestSeq) return
    errorMsg.value = String(e)
  } finally {
    if (requestSeq === loadRequestSeq) loading.value = false
  }
}

watch(() => [props.repoId, props.filePath], load, { immediate: true })

const alignment = computed(() => {
  if (!conflict.value || conflict.value.is_binary) {
    return { rows: [], hunks: [] }
  }
  return buildConflictAlignment(conflict.value.ours ?? '', conflict.value.theirs ?? '')
})

const rows = computed(() => alignment.value.rows)
const hunks = computed(() => alignment.value.hunks)
const conflictCount = computed(() => hunks.value.length)

const {
  selectedRows,
  currentHunkIdx,
  selectedCount,
  totalSelectable,
  toggleRow,
  useAllOurs,
  useAllTheirs,
  clearAll,
  isRowSelectable,
  isRowChecked,
  hunkSideIdxs,
  hunkAllChecked,
  hunkSomeChecked,
  toggleHunk,
} = useConflictSelection(rows, hunks)

const syntaxLang = computed(() => {
  if (isVuePath(props.filePath)) return null
  return detectLangByPath(props.filePath)
})

const oursVueLangMap = computed(() => (
  isVuePath(props.filePath) ? createVueSfcLineLangMap(conflict.value?.ours) : null
))
const theirsVueLangMap = computed(() => (
  isVuePath(props.filePath) ? createVueSfcLineLangMap(conflict.value?.theirs) : null
))

const outputMap = computed(() => buildConflictOutputMap(rows.value, selectedRows.value))

const outputLines = computed(() => outputMap.value.lines)
const rowIdxToOutputLine = computed(() => outputMap.value.rowToLine)
const outputLineToRowIdx = computed(() => outputMap.value.lineToRow)

const savedText = computed(() => outputLines.value.join('\n'))
const outputVueLangMap = computed(() => (
  isVuePath(props.filePath) ? createVueSfcLineLangMap(savedText.value) : null
))
const hasMarkers = computed(() => /^<<<<<<< /m.test(savedText.value))

// 按实际最大行号计算 lineno 宽度，避免 2 位数行号在 40px 右对齐列中飘远
const linenoWidth = computed(() => {
  let max = 0
  for (const r of rows.value) {
    if (r.leftNo && r.leftNo > max) max = r.leftNo
    if (r.rightNo && r.rightNo > max) max = r.rightNo
  }
  const digits = Math.max(2, String(Math.max(max, outputLines.value.length)).length)
  return digits * 8 + 2
})

const {
  paneARowsRef,
  paneBRowsRef,
  paneOutputRowsRef,
  virtualizerA,
  virtualizerB,
  virtualizerO,
  maxChars,
  maxOutputChars,
  onPaneAScroll,
  onPaneBScroll,
  onOutputScroll,
  goPrevHunk,
  goNextHunk,
} = useSyncedConflictPanes({
  rows,
  outputLines,
  hunks,
  conflictCount,
  rowIdxToOutputLine,
  outputLineToRowIdx,
  currentHunkIdx,
})

function lineHtml(content: string, side: 'ours' | 'theirs' | 'output', lineNo: number | null): string {
  if (content === '') return ''
  if (syntaxLang.value) return highlightLine(content, syntaxLang.value)
  if (!isVuePath(props.filePath)) return highlightLine(content, null)
  const map = side === 'ours'
    ? oursVueLangMap.value
    : side === 'theirs'
      ? theirsVueLangMap.value
      : outputVueLangMap.value
  return highlightLine(content, map?.langForLine(lineNo) ?? 'html')
}

async function onSave() {
  const repoId = props.repoId
  const file = conflict.value
  if (!repoId || !file || file.path !== props.filePath) {
    errorMsg.value = t('conflict.view.contextChanged')
    return
  }
  saving.value = true
  errorMsg.value = null
  try {
    await mr.resolveConflict(repoId, file, savedText.value)
    emit('close')
  } catch (e) {
    errorMsg.value = String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="conflict-view">
    <!-- Toolbar -->
    <div class="toolbar">
      <span class="file-path" :title="filePath ?? ''">
        <svg class="warn-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        {{ filePath }}
        <span class="hint" v-if="conflictCount > 0">
          ({{ t('conflict.view.conflictCount', { n: conflictCount }) }})
        </span>
      </span>

      <div class="spacer" />

      <button class="btn btn-secondary" @click="useAllOurs">
        {{ t('conflict.view.useAllOurs') }}
      </button>
      <button class="btn btn-secondary" @click="useAllTheirs">
        {{ t('conflict.view.useAllTheirs') }}
      </button>
      <button class="btn btn-secondary" @click="clearAll">
        {{ t('conflict.view.clearAll') }}
      </button>
      <button
        class="btn btn-primary"
        :disabled="saving || !conflict || conflict.is_binary"
        @click="onSave"
      >
        {{ saving ? t('conflict.view.saving') : t('conflict.view.save') }}
      </button>
      <button class="btn-icon" :title="t('diff.toolbar.close')" @click="emit('close')">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div v-if="loading" class="state">{{ t('conflict.view.loading') }}</div>
    <div v-else-if="conflict?.is_binary" class="state binary">
      {{ t('conflict.view.binary') }}
    </div>

    <!-- 双栏 + 底部 Output -->
    <div v-else class="body" :style="{ '--lineno-w': linenoWidth + 'px' }">
      <div class="panes">
        <!-- A 栏 -->
        <div class="pane pane-a">
          <div class="pane-header">
            <span class="pane-tag tag-a">A</span>
            <span class="pane-label">{{ t('conflict.view.labelOurs') }}</span>
          </div>
          <div class="rows" ref="paneARowsRef" @scroll="onPaneAScroll">
            <div
              class="rows-inner"
              :style="{
                height: virtualizerA.getTotalSize() + 'px',
                width: `calc(72px + ${maxChars}ch)`,
                minWidth: '100%',
              }"
            >
              <div
                v-for="vRow in virtualizerA.getVirtualItems()"
                :key="'l' + vRow.index"
                :id="'conflict-row-' + vRow.index"
                :class="[
                  rows[vRow.index].baseCls,
                  isRowChecked(vRow.index, 'a') ? 'row-selected' : '',
                ]"
                :style="{ position: 'absolute', top: vRow.start + 'px', left: '0', right: '0' }"
                @click="isRowSelectable(vRow.index, 'a') && toggleRow(vRow.index, 'a')"
              >
                <span class="check-col">
                  <input
                    v-if="rows[vRow.index].status === 'hunk-header' && hunkSideIdxs(rows[vRow.index].hunkId!, 'a').length > 0"
                    type="checkbox"
                    class="hunk-master"
                    :title="t('conflict.view.toggleHunk')"
                    :checked="hunkAllChecked(rows[vRow.index].hunkId!, 'a')"
                    :indeterminate.prop="hunkSomeChecked(rows[vRow.index].hunkId!, 'a')"
                    @click.stop
                    @change="toggleHunk(rows[vRow.index].hunkId!, 'a')"
                  />
                  <input
                    v-else-if="isRowSelectable(vRow.index, 'a')"
                    type="checkbox"
                    :checked="isRowChecked(vRow.index, 'a')"
                    @click.stop
                    @change="toggleRow(vRow.index, 'a')"
                  />
                </span>
                <span class="lineno">{{ rows[vRow.index].leftNo ?? '' }}</span>
                <span class="code" v-html="lineHtml(rows[vRow.index].left ?? '', 'ours', rows[vRow.index].leftNo)" />
              </div>
            </div>
          </div>
        </div>

        <!-- B 栏 -->
        <div class="pane pane-b">
          <div class="pane-header">
            <span class="pane-tag tag-b">B</span>
            <span class="pane-label">{{ t('conflict.view.labelTheirs') }}</span>
          </div>
          <div class="rows" ref="paneBRowsRef" @scroll="onPaneBScroll">
            <div
              class="rows-inner"
              :style="{
                height: virtualizerB.getTotalSize() + 'px',
                width: `calc(72px + ${maxChars}ch)`,
                minWidth: '100%',
              }"
            >
              <div
                v-for="vRow in virtualizerB.getVirtualItems()"
                :key="'r' + vRow.index"
                :class="[
                  rows[vRow.index].baseCls,
                  isRowChecked(vRow.index, 'b') ? 'row-selected' : '',
                ]"
                :style="{ position: 'absolute', top: vRow.start + 'px', left: '0', right: '0' }"
                @click="isRowSelectable(vRow.index, 'b') && toggleRow(vRow.index, 'b')"
              >
                <span class="check-col">
                  <input
                    v-if="rows[vRow.index].status === 'hunk-header' && hunkSideIdxs(rows[vRow.index].hunkId!, 'b').length > 0"
                    type="checkbox"
                    class="hunk-master"
                    :title="t('conflict.view.toggleHunk')"
                    :checked="hunkAllChecked(rows[vRow.index].hunkId!, 'b')"
                    :indeterminate.prop="hunkSomeChecked(rows[vRow.index].hunkId!, 'b')"
                    @click.stop
                    @change="toggleHunk(rows[vRow.index].hunkId!, 'b')"
                  />
                  <input
                    v-else-if="isRowSelectable(vRow.index, 'b')"
                    type="checkbox"
                    :checked="isRowChecked(vRow.index, 'b')"
                    @click.stop
                    @change="toggleRow(vRow.index, 'b')"
                  />
                </span>
                <span class="lineno">{{ rows[vRow.index].rightNo ?? '' }}</span>
                <span class="code" v-html="lineHtml(rows[vRow.index].right ?? '', 'theirs', rows[vRow.index].rightNo)" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Output 区（只读逐行渲染） -->
      <div class="output">
        <div class="output-header">
          <span class="output-title">Output</span>
          <span class="output-hint">{{ t('conflict.view.outputReadonly') }}</span>
          <div class="nav-row">
            <span class="nav-label" v-if="conflictCount > 0">
              {{ t('conflict.view.nav', { cur: currentHunkIdx + 1, total: conflictCount }) }}
            </span>
            <span class="nav-label selected-count" v-if="totalSelectable > 0">
              {{ t('conflict.view.selected', { sel: selectedCount, total: totalSelectable }) }}
            </span>
            <button class="btn-nav" :disabled="conflictCount === 0" @click="goPrevHunk">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <button class="btn-nav" :disabled="conflictCount === 0" @click="goNextHunk">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
          <span v-if="hasMarkers" class="warn">{{ t('conflict.view.markersPresent') }}</span>
        </div>
        <div class="rows rows-output" ref="paneOutputRowsRef" @scroll="onOutputScroll">
          <div
            class="rows-inner"
            :style="{
              height: virtualizerO.getTotalSize() + 'px',
              width: `calc(60px + ${maxOutputChars}ch)`,
              minWidth: '100%',
            }"
          >
            <div
              v-for="vRow in virtualizerO.getVirtualItems()"
              :key="'o' + vRow.index"
              class="row row-output"
              :style="{ position: 'absolute', top: vRow.start + 'px', left: '0', right: '0' }"
            >
              <span class="lineno">{{ vRow.index + 1 }}</span>
              <span class="code" v-html="lineHtml(outputLines[vRow.index] ?? '', 'output', vRow.index + 1)" />
            </div>
          </div>
        </div>
      </div>

      <div v-if="errorMsg" class="err">{{ errorMsg }}</div>
    </div>
  </div>
</template>

<style scoped>
.conflict-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 10px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: var(--font-xs);
  height: 22px;
  white-space: nowrap;
}

.file-path {
  color: var(--text-secondary);
  font-family: var(--code-font-family, 'SF Mono', monospace);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.warn-icon {
  color: var(--accent-orange);
  flex-shrink: 0;
}

.hint {
  color: var(--text-muted);
  font-size: var(--font-xs);
  margin-left: 2px;
}

.spacer {
  flex: 1;
}

.btn {
  padding: 0 8px;
  height: 18px;
  line-height: 16px;
  border-radius: 3px;
  font-size: var(--font-xs);
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  flex-shrink: 0;
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-overlay);
  color: var(--text-primary);
  border-color: var(--border);
}

.btn-secondary:hover {
  background: var(--bg-primary);
}

.btn-primary {
  background: var(--accent-blue);
  color: var(--bg-primary);
  font-weight: 600;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 16px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.btn-icon:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.state {
  padding: 32px;
  text-align: center;
  color: var(--text-secondary);
}

.state.binary {
  color: var(--accent-red);
}

.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.panes {
  flex: 1 1 55%;
  min-height: 120px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow: hidden;
}

.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border);
}

.pane-b {
  border-right: none;
}

.pane-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  height: 20px;
  font-size: var(--font-xs);
  font-family: var(--code-font-family, 'SF Mono', monospace);
  background: var(--bg-overlay);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  white-space: nowrap;
}

.pane-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-weight: 700;
  font-size: 10px;
  border-radius: 3px;
  border: 1.5px solid;
  line-height: 1;
}

.tag-a {
  color: var(--accent-blue);
  border-color: var(--accent-blue);
  background: color-mix(in oklab, var(--accent-blue) 15%, transparent);
}

.tag-b {
  color: var(--accent-orange);
  border-color: var(--accent-orange);
  background: color-mix(in oklab, var(--accent-orange) 15%, transparent);
}

.pane-label {
  color: var(--text-secondary);
}

.rows {
  flex: 1;
  overflow: auto;
  font-family: var(--code-font-family, 'SF Mono', monospace);
  font-size: var(--font-md);
  line-height: 20px;
}

.rows-inner {
  position: relative;
}

.row {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 0 8px 0 0;
  height: 20px;
  line-height: 20px;
  white-space: pre;
  cursor: default;
}

.row .check-col {
  width: 20px;
  flex: 0 0 20px;
}

.row .lineno {
  width: var(--lineno-w, 40px);
  flex: 0 0 var(--lineno-w, 40px);
}

.row .code {
  flex: 1 0 auto;
  white-space: pre;
  overflow: visible;
  margin-left: 6px;
}

.row[class*='row-diff'] {
  cursor: pointer;
}

/* 高亮整个 hunk 底色 */
.row-diff {
  background: rgba(238, 212, 159, 0.05);
}

.row-left-only .code {
  background: rgba(166, 218, 149, 0.15);
}

.row-right-only .code {
  background: rgba(138, 173, 244, 0.15);
}

.row-changed .code {
  background: rgba(238, 212, 159, 0.15);
}

.row-selected {
  background: rgba(138, 173, 244, 0.18);
}

.pane-b .row-selected {
  background: rgba(238, 212, 159, 0.22);
}

.check-col {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.check-col input[type='checkbox'] {
  cursor: pointer;
  accent-color: var(--accent-blue);
  width: 13px;
  height: 13px;
}

.pane-b .check-col input[type='checkbox'] {
  accent-color: var(--accent-orange);
}

/* 组头行：圆形 master checkbox，视觉区别于 per-line 方形勾选 */
.row-hunk-header {
  background: rgba(138, 173, 244, 0.04);
  cursor: default;
}

.pane-a .hunk-master { --hunk-accent: var(--accent-blue); }
.pane-b .hunk-master { --hunk-accent: var(--accent-orange); }

.hunk-master {
  appearance: none;
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--text-muted);
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  margin: 0;
  padding: 0;
  position: relative;
}

.hunk-master:hover {
  border-color: var(--hunk-accent);
}

.hunk-master:checked,
.hunk-master:indeterminate {
  background: var(--hunk-accent);
  border-color: var(--hunk-accent);
}

.hunk-master:checked::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 0;
  width: 3px;
  height: 7px;
  border: solid var(--bg-primary);
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

.hunk-master:indeterminate::after {
  content: '';
  position: absolute;
  inset: 3px;
  background: var(--bg-primary);
  border-radius: 50%;
}

.lineno {
  color: var(--text-muted);
  text-align: right;
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.code {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Output 区 ────────────────────────────────── */

.output {
  flex: 1 1 45%;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-primary);
  min-width: 0;
}

.output-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  height: 20px;
  background: var(--bg-overlay);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: var(--font-xs);
  white-space: nowrap;
}

.output-title {
  font-weight: 600;
  color: var(--text-primary);
}

.output-hint {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.nav-row {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
}

.nav-label {
  color: var(--accent-blue);
  font-size: var(--font-xs);
  font-family: var(--code-font-family, 'SF Mono', monospace);
}

.nav-label.selected-count {
  color: var(--text-muted);
  margin-left: 2px;
}

.btn-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-primary);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.btn-nav:hover:not(:disabled) {
  background: var(--bg-overlay);
}

.btn-nav:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.warn {
  color: var(--accent-orange);
  font-size: var(--font-xs);
  font-weight: 500;
  flex-shrink: 0;
  white-space: nowrap;
}

.rows-output {
  user-select: text;
}

.row-output {
  cursor: default;
}

.row-output .lineno {
  width: 48px;
  flex: 0 0 48px;
}

.row-output .code {
  flex: 1 0 auto;
  white-space: pre;
}

.err {
  padding: 6px 10px;
  color: var(--accent-red);
  font-size: var(--font-sm);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}
</style>
