<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const query = defineModel<string>({ required: true })
const emit = defineEmits<{
  open: []
}>()

const { t } = useI18n()
const inputRef = ref<HTMLInputElement | null>(null)
const expanded = ref(false)

watch(
  () => query.value,
  (value) => {
    if (value) expanded.value = true
  },
)

async function expandSearch() {
  emit('open')
  expanded.value = true
  await nextTick()
  inputRef.value?.focus()
}

function clearSearch() {
  query.value = ''
  inputRef.value?.focus()
}

function onBlur() {
  if (!query.value) expanded.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  query.value = ''
  expanded.value = false
  inputRef.value?.blur()
}
</script>

<template>
  <div
    class="sidebar-search-control"
    :class="{ 'sidebar-search-control--expanded': expanded || query }"
    @click.stop
  >
    <button
      class="sidebar-search-button"
      type="button"
      :title="t('sidebar.search.title')"
      :aria-label="t('sidebar.search.title')"
      @click="expandSearch"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
      >
        <circle cx="11" cy="11" r="7" />
        <line x1="16.65" y1="16.65" x2="21" y2="21" />
      </svg>
    </button>
    <input
      v-show="expanded || query"
      ref="inputRef"
      v-model="query"
      class="sidebar-search-input"
      type="text"
      :placeholder="t('sidebar.search.placeholder')"
      :aria-label="t('sidebar.search.title')"
      spellcheck="false"
      autocomplete="off"
      @blur="onBlur"
      @keydown="onKeydown"
    />
    <button
      v-show="query"
      class="sidebar-search-clear"
      type="button"
      :title="t('sidebar.search.clear')"
      :aria-label="t('sidebar.search.clear')"
      @mousedown.prevent
      @click="clearSearch"
    >×</button>
  </div>
</template>

<style scoped>
.sidebar-search-control {
  width: 20px;
  height: 20px;
  display: none;
  align-items: center;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  transition: width 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

:global(.section:hover) .sidebar-search-control,
:global(.repos-footer:hover) .sidebar-search-control,
.sidebar-search-control--expanded {
  display: inline-flex;
}

.sidebar-search-control--expanded {
  width: 112px;
  border-color: var(--border);
  background: var(--bg-surface);
}

.sidebar-search-control:focus-within {
  border-color: var(--accent-blue);
}

.sidebar-search-button,
.sidebar-search-clear {
  width: 20px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.sidebar-search-button:hover,
.sidebar-search-clear:hover {
  color: var(--text-primary);
}

.sidebar-search-input {
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-xs);
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}

.sidebar-search-input::placeholder {
  color: var(--text-muted);
}

.sidebar-search-clear {
  width: 16px;
  font-size: var(--font-base);
}
</style>
