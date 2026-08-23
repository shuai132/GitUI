<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileDiff } from '@/types/git'
import { useUiStore } from '@/stores/ui'
import { useShortcutsStore, bindingToLabel, type ShortcutActionId } from '@/stores/shortcuts'
import { useDiffSearch } from '@/composables/diff/useDiffSearch'
import type { PreviewKind } from '@/lib/preview'

const props = defineProps<{
  diff: FileDiff
  isImageView: boolean
  previewKind: PreviewKind
  svgTextMode: boolean
  currentChangeIdx: number
  changeCount: number
  hasLeading?: boolean
}>()

const emit = defineEmits<{
  close: []
  prevChange: []
  nextChange: []
  'update:svgTextMode': [value: boolean]
}>()

const { t } = useI18n()
const uiStore = useUiStore()
const shortcutsStore = useShortcutsStore()
const {
  searchBoxEl,
  searchInputEl,
  searchExpanded,
  expandSearch,
  onSearchBlur,
  onSearchKeydown,
  findNext,
  clearSearch,
} = useDiffSearch()

function withShortcut(label: string, actionId: ShortcutActionId): string {
  const b = shortcutsStore.bindings[actionId]
  return b ? `${label} (${bindingToLabel(b)})` : label
}

const currentChangeLabel = computed(() => {
  if (props.changeCount <= 0 || props.currentChangeIdx < 0) return `0/${props.changeCount}`
  return `${props.currentChangeIdx + 1}/${props.changeCount}`
})

const canIgnoreWhitespace = computed(() =>
  !props.isImageView &&
  props.previewKind !== 'pdf' &&
  props.previewKind !== 'docx' &&
  props.previewKind !== 'pptx',
)
</script>

<template>
  <div class="diff-toolbar" :class="{ 'diff-toolbar--has-leading': hasLeading }">
    <slot name="leading" />
    <span class="diff-file-path" :title="diff.new_path ?? diff.old_path">
      <span class="diff-file-path-text"><bdi>{{ diff.new_path ?? diff.old_path }}</bdi></span>
    </span>
    <span class="diff-file-stats" v-if="!isImageView">
      <span class="add">+{{ diff.additions }}</span>
      <span class="del">-{{ diff.deletions }}</span>
    </span>
    <span
      v-if="!isImageView && diff.encoding"
      class="diff-encoding"
      :class="{ 'diff-encoding--non-utf8': diff.encoding !== 'UTF-8' }"
      :title="`File encoding: ${diff.encoding}`"
    >{{ diff.encoding }}</span>

    <div class="toolbar-spacer" />

    <div
      v-if="!isImageView"
      ref="searchBoxEl"
      class="search-box"
      :class="{ 'search-box--expanded': searchExpanded || uiStore.diffSearchQuery }"
    >
      <button
        type="button"
        class="search-icon-btn"
        :title="withShortcut(t('toolbar.title.search'), 'search')"
        :aria-label="withShortcut(t('toolbar.title.search'), 'search')"
        :aria-expanded="searchExpanded || !!uiStore.diffSearchQuery"
        aria-controls="diff-search-input"
        @click="expandSearch"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      </button>
      <input
        id="diff-search-input"
        v-show="searchExpanded || uiStore.diffSearchQuery"
        ref="searchInputEl"
        v-model="uiStore.diffSearchQuery"
        class="search-input"
        :placeholder="t('toolbar.search.placeholder')"
        spellcheck="false"
        autocomplete="off"
        @blur="onSearchBlur"
        @keydown="onSearchKeydown"
      />
      <button
        v-show="uiStore.diffSearchQuery"
        class="search-clear-btn"
        tabindex="-1"
        @mousedown.prevent
        @click="clearSearch"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <div v-show="searchExpanded || uiStore.diffSearchQuery" class="search-nav">
        <button
          type="button"
          class="search-nav-btn"
          :title="t('diff.toolbar.prevSearchResult')"
          :aria-label="t('diff.toolbar.prevSearchResult')"
          @click="findNext(true)"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </button>
        <button
          type="button"
          class="search-nav-btn"
          :title="t('diff.toolbar.nextSearchResult')"
          :aria-label="t('diff.toolbar.nextSearchResult')"
          @click="findNext(false)"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="toolbar-divider" v-if="!isImageView" />

    <template v-if="!isImageView">
      <div class="change-nav">
        <div class="change-nav-buttons">
          <button
            class="change-nav-btn"
            :title="t('diff.toolbar.prevChange')"
            @click="emit('prevChange')"
          >
            <svg width="12" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          <button
            class="change-nav-btn"
            :title="t('diff.toolbar.nextChange')"
            @click="emit('nextChange')"
          >
            <svg width="12" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
        <span class="change-count" :title="currentChangeLabel">{{ currentChangeLabel }}</span>
      </div>

      <div class="toolbar-divider" />

      <button
        v-if="canIgnoreWhitespace"
        class="btn-icon btn-ignore-whitespace"
        :class="{ active: uiStore.diffIgnoreWhitespace }"
        :title="uiStore.diffIgnoreWhitespace ? t('diff.toolbar.showWhitespace') : t('diff.toolbar.ignoreWhitespace')"
        @click="uiStore.toggleDiffIgnoreWhitespace()"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9.5 2.5H7a3 3 0 0 0 0 6h1.5" />
          <path d="M9.5 2.5v11M12 2.5v11" />
          <line v-if="uiStore.diffIgnoreWhitespace" x1="2.5" y1="13.5" x2="13.5" y2="2.5" stroke-width="2" />
        </svg>
      </button>

      <button
        class="btn-icon"
        :class="{ active: uiStore.diffGroupByHunk }"
        :title="t('diff.mode.byHunk')"
        @click="uiStore.toggleDiffGroupByHunk()"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="5" rx="1" />
          <rect x="2" y="9" width="12" height="5" rx="1" />
        </svg>
      </button>
      <button
        class="btn-icon"
        :class="{ active: uiStore.diffLayoutMode === 'inline' }"
        :title="t('diff.mode.inline')"
        @click="uiStore.setDiffLayoutMode('inline')"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <line x1="2" y1="4" x2="14" y2="4" />
          <line x1="2" y1="8" x2="14" y2="8" />
          <line x1="2" y1="12" x2="14" y2="12" />
        </svg>
      </button>
      <button
        class="btn-icon"
        :class="{ active: uiStore.diffLayoutMode === 'side-by-side' }"
        :title="t('diff.mode.sideBySide')"
        @click="uiStore.setDiffLayoutMode('side-by-side')"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="12" rx="1" />
          <line x1="8" y1="2" x2="8" y2="14" />
        </svg>
      </button>

      <div class="toolbar-divider" />
    </template>

    <template v-if="previewKind === 'svg'">
      <button
        class="btn-icon"
        :class="{ active: !svgTextMode }"
        :title="t('diff.toolbar.imagePreview')"
        @click="emit('update:svgTextMode', false)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </button>
      <button
        class="btn-icon"
        :class="{ active: svgTextMode }"
        :title="t('diff.toolbar.textDiff')"
        @click="emit('update:svgTextMode', true)"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <line x1="2" y1="4" x2="14" y2="4" />
          <line x1="2" y1="8" x2="14" y2="8" />
          <line x1="2" y1="12" x2="10" y2="12" />
        </svg>
      </button>
      <div class="toolbar-divider" />
    </template>

    <button class="btn-icon" :title="t('diff.toolbar.close')" @click="emit('close')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.diff-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px 5px 24px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: var(--font-sm);
  min-height: 28px;
}

.diff-toolbar--has-leading {
  padding-left: 4px;
}

.diff-file-path {
  color: var(--text-secondary);
  font-family: var(--code-font-family, 'SF Mono', monospace);
  overflow: hidden;
  min-width: 0;
}

.diff-file-path-text {
  display: inline-block;
  vertical-align: middle;
  max-width: 100%;
  direction: rtl;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-file-stats {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.add { color: var(--accent-green); }
.del { color: var(--accent-red); }

.diff-encoding {
  font-size: 10px;
  font-family: var(--code-font-family, 'SF Mono', monospace);
  color: var(--text-muted);
  flex-shrink: 0;
  letter-spacing: 0.02em;
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
}

.diff-encoding--non-utf8 {
  color: #f5a623;
  background: rgba(245, 166, 35, 0.12);
  border-color: rgba(245, 166, 35, 0.28);
  font-weight: 500;
}

.toolbar-spacer {
  flex: 1;
}

.toolbar-divider {
  width: 1px;
  height: 16px;
  background: var(--border);
  margin: 0 4px;
}

.change-nav {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.change-nav-buttons {
  display: inline-flex;
  flex-direction: column;
  width: 18px;
  height: 22px;
  overflow: hidden;
  border-radius: 4px;
}

.change-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 11px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  transition: background 0.1s, color 0.1s;
}

.change-nav-btn:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.change-count {
  min-width: 28px;
  color: var(--text-muted);
  font-family: var(--code-font-family, 'SF Mono', monospace);
  font-size: 10px;
  line-height: 12px;
  text-align: right;
  user-select: none;
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  padding: 0;
  flex-shrink: 0;
}

.btn-icon:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.btn-icon.active {
  background: rgba(138, 173, 244, 0.18);
  color: var(--accent-blue);
}

.search-box {
  display: flex;
  align-items: center;
  border-radius: 4px;
  overflow: hidden;
  transition: width 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  width: 26px;
  border: 1px solid transparent;
  background: transparent;
}

.search-box--expanded {
  width: 180px;
  border-color: var(--border);
  background: var(--bg-surface);
  padding-right: 4px;
}

.search-icon-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  border-radius: 4px;
  padding: 0;
  transition: color 0.15s;
}

.search-icon-btn:hover {
  color: var(--text-primary);
}

.search-box--expanded .search-icon-btn {
  cursor: default;
}

.search-input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: var(--font-sm);
  font-family: inherit;
  outline: none;
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-clear-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  border-radius: 4px;
  padding: 0;
  transition: color 0.15s, background 0.15s;
  margin-right: 2px;
}

.search-clear-btn:hover {
  color: var(--text-primary);
  background: var(--bg-overlay);
}

.search-nav {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: 2px;
}

.search-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  border-radius: 4px;
  padding: 0;
  transition: color 0.15s, background 0.15s;
}

.search-nav-btn:hover {
  color: var(--text-primary);
  background: var(--bg-overlay);
}
</style>
