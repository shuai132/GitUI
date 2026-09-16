<script setup lang="ts" generic="T extends string | number">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SelectOption } from '@/types/select'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  modelValue: T | null
  options: readonly SelectOption<T>[]
  ariaLabel: string
  id?: string
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  searchable?: boolean
  compact?: boolean
  /** Enables free text; the caller retains control of the value's domain type. */
  customValue?: (text: string) => T
}>(), { disabled: false, loading: false, searchable: false, compact: false })
const emit = defineEmits<{
  'update:modelValue': [value: T]
  select: [value: T]
}>()
const { t } = useI18n()
const uid = useId()
const controlId = computed(() => props.id ?? `select-${uid}`)
const listId = `select-list-${uid}`
const root = ref<HTMLElement | null>(null)
const control = ref<HTMLInputElement | HTMLButtonElement | null>(null)
const popup = ref<HTMLElement | null>(null)
const list = ref<HTMLElement | null>(null)
const portalTarget = ref<HTMLElement | string>('body')
const opened = ref(false)
const query = ref('')
const active = ref(-1)
const scrollTop = ref(0)
const rowHeight = ref(32)
const listHeight = ref(280)
const popupStyle = ref<Record<string, string>>({})
const editable = computed(() => props.searchable || !!props.customValue)
const unavailable = computed(() => props.disabled || props.loading)
const selectedLabel = computed(() => props.options.find(option => option.value === props.modelValue)?.label
  ?? (props.customValue && props.modelValue !== null ? String(props.modelValue) : ''))
const inputValue = computed(() => opened.value ? query.value : selectedLabel.value)
const searchLabels = computed(() => props.options.map(option => option.label.toLocaleLowerCase()))
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  if (!editable.value || !needle) return props.options
  return props.options.filter((_, index) => searchLabels.value[index].includes(needle))
})
// Fixed-height, single-line options keep large branch/font lists bounded in the DOM.
const firstVisible = computed(() => Math.max(0, Math.floor(scrollTop.value / rowHeight.value) - 3))
const visibleOptions = computed(() => {
  const end = firstVisible.value + Math.ceil(listHeight.value / rowHeight.value) + 7
  return filtered.value.slice(firstVisible.value, end).map((option, offset) => ({
    option, index: firstVisible.value + offset,
  }))
})
const activeId = computed(() => opened.value && visibleOptions.value.some(item => item.index === active.value)
  ? `${listId}-${active.value}` : undefined)
let observer: ResizeObserver | undefined
let clippingParents: Array<{ element: HTMLElement; horizontal: boolean; vertical: boolean }> = []
let frame = 0
let typeahead = ''
let lastTyped = 0

function positionPopup() {
  if (!opened.value || !control.value) return
  const rect = control.value.getBoundingClientRect()
  if (!control.value.isConnected || !control.value.getClientRects().length) {
    close()
    return
  }
  const viewport = window.visualViewport
  const viewportTop = viewport?.offsetTop ?? 0
  const viewportLeft = viewport?.offsetLeft ?? 0
  const viewportWidth = viewport?.width ?? window.innerWidth
  const viewportHeight = viewport?.height ?? window.innerHeight
  const outsideViewport = rect.bottom <= viewportTop || rect.top >= viewportTop + viewportHeight
    || rect.right <= viewportLeft || rect.left >= viewportLeft + viewportWidth
  const clipped = clippingParents.some(({ element, horizontal, vertical }) => {
    const parent = element.getBoundingClientRect()
    return (vertical && (rect.bottom <= parent.top || rect.top >= parent.bottom))
      || (horizontal && (rect.right <= parent.left || rect.left >= parent.right))
  })
  if (outsideViewport || clipped) { close(); return }
  const margin = 8
  const gap = 4
  const font = getComputedStyle(control.value)
  rowHeight.value = Math.max(28, Math.ceil((parseFloat(font.fontSize) || 13) * 1.5 + 12))
  const desiredHeight = Math.min(8, Math.max(1, filtered.value.length)) * rowHeight.value + 10
  const below = Math.max(0, viewportTop + viewportHeight - rect.bottom - margin - gap)
  const above = Math.max(0, rect.top - viewportTop - margin - gap)
  const upwards = below < desiredHeight && above > below
  const height = Math.min(desiredHeight, upwards ? above : below)
  const width = Math.min(Math.max(rect.width, props.compact ? 180 : 240), viewportWidth - margin * 2)
  listHeight.value = Math.max(0, height - 10)
  popupStyle.value = {
    left: `${Math.max(viewportLeft + margin, Math.min(rect.left, viewportLeft + viewportWidth - width - margin))}px`,
    top: `${upwards ? rect.top - gap - height : rect.bottom + gap}px`,
    width: `${width}px`,
    fontSize: font.fontSize,
    fontFamily: font.fontFamily,
  }
}

function schedulePosition(event?: Event) {
  if (event?.target instanceof Node && popup.value?.contains(event.target)) return
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    positionPopup()
  })
}

function scrollToActive() {
  if (!list.value || active.value < 0) return
  const top = active.value * rowHeight.value
  const bottom = top + rowHeight.value
  if (top < list.value.scrollTop) list.value.scrollTop = top
  else if (bottom > list.value.scrollTop + listHeight.value) list.value.scrollTop = bottom - listHeight.value
  scrollTop.value = list.value.scrollTop
}

function activate(index: number) {
  active.value = index
  scrollToActive()
}

function edge(direction: 1 | -1): number {
  for (let i = direction === 1 ? 0 : filtered.value.length - 1; i >= 0 && i < filtered.value.length; i += direction) {
    if (!filtered.value[i].disabled) return i
  }
  return -1
}

function move(direction: 1 | -1) {
  if (active.value < 0) { activate(edge(direction)); return }
  for (let i = active.value + direction; i >= 0 && i < filtered.value.length; i += direction) {
    if (!filtered.value[i].disabled) { activate(i); return }
  }
}

async function open(direction: 1 | -1 = 1) {
  if (unavailable.value || opened.value) return
  query.value = props.customValue ? selectedLabel.value : ''
  portalTarget.value = root.value?.closest<HTMLElement>('[role="dialog"]') ?? 'body'
  clippingParents = []
  for (let parent = root.value?.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const horizontal = /auto|scroll|hidden|clip/.test(style.overflowX)
    const vertical = /auto|scroll|hidden|clip/.test(style.overflowY)
    if (horizontal || vertical) clippingParents.push({ element: parent, horizontal, vertical })
  }
  opened.value = true
  typeahead = ''
  scrollTop.value = 0
  const selected = filtered.value.findIndex(option => option.value === props.modelValue && !option.disabled)
  active.value = selected >= 0 ? selected : edge(direction)
  attachListeners()
  await nextTick()
  if (!opened.value) return
  positionPopup()
  await nextTick()
  if (!opened.value) return
  scrollToActive()
  observer = new ResizeObserver(() => schedulePosition())
  if (root.value) observer.observe(root.value)
}

function close() {
  opened.value = false
  active.value = -1
  typeahead = ''
  detachListeners()
}

function choose(index: number) {
  const option = filtered.value[index]
  if (!option || option.disabled || unavailable.value) return
  emit('update:modelValue', option.value)
  // Action controls (e.g. heading navigation) also need repeated selections.
  emit('select', option.value)
  close()
  control.value?.focus({ preventScroll: true })
}

function onInput(event: Event) {
  if (!(event.target instanceof HTMLInputElement) || unavailable.value) return
  if (!opened.value) void open()
  query.value = event.target.value
  if (props.customValue) emit('update:modelValue', props.customValue(query.value))
}

function onClick() {
  if (opened.value && !editable.value) close()
  else void open()
}

function onKeydown(event: KeyboardEvent) {
  if (unavailable.value || event.isComposing) return
  if (event.key === 'Tab') { close(); return }
  if (event.key === 'Escape') {
    if (!opened.value) return
    close()
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const direction = event.key === 'ArrowDown' ? 1 : -1
    if (!opened.value) void open(direction)
    else move(direction)
  } else if (event.key === 'Enter' || (!editable.value && event.key === ' ')) {
    if (!opened.value) void open()
    else choose(active.value)
  } else if (!editable.value && (event.key === 'Home' || event.key === 'End')) {
    if (!opened.value) void open()
    activate(edge(event.key === 'Home' ? 1 : -1))
  } else if (!editable.value && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (!opened.value) void open()
    const now = Date.now()
    typeahead = now - lastTyped > 700 ? event.key : typeahead + event.key
    lastTyped = now
    const needle = typeahead.toLocaleLowerCase()
    const repeating = Array.from(needle).every(char => char === needle[0])
    const prefix = repeating ? needle[0] : needle
    const start = repeating ? active.value + 1 : active.value
    for (let offset = 0; offset < filtered.value.length; offset++) {
      const index = (Math.max(0, start) + offset) % filtered.value.length
      const option = filtered.value[index]
      if (!option.disabled && option.label.trimStart().toLocaleLowerCase().startsWith(prefix)) {
        activate(index)
        break
      }
    }
  } else {
    // Text editing remains native; prevent app shortcuts from consuming input keys.
    if (editable.value) event.stopPropagation()
    return
  }
  event.preventDefault()
  event.stopPropagation()
}

function onWindowKeydown(event: KeyboardEvent) {
  // Modal handles Escape in document capture. An open select gets first refusal.
  if (event.target === control.value) onKeydown(event)
}

function onOutsidePointer(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target) && !popup.value?.contains(event.target)) close()
}

function attachListeners() {
  window.addEventListener('keydown', onWindowKeydown, true)
  document.addEventListener('pointerdown', onOutsidePointer, true)
  window.addEventListener('scroll', schedulePosition, true)
  window.addEventListener('resize', schedulePosition)
  window.visualViewport?.addEventListener('resize', schedulePosition)
  window.visualViewport?.addEventListener('scroll', schedulePosition)
}

function detachListeners() {
  window.removeEventListener('keydown', onWindowKeydown, true)
  document.removeEventListener('pointerdown', onOutsidePointer, true)
  window.removeEventListener('scroll', schedulePosition, true)
  window.removeEventListener('resize', schedulePosition)
  window.visualViewport?.removeEventListener('resize', schedulePosition)
  window.visualViewport?.removeEventListener('scroll', schedulePosition)
  observer?.disconnect()
  observer = undefined
  clippingParents = []
  if (frame) cancelAnimationFrame(frame)
  frame = 0
}

watch(filtered, async () => {
  if (!opened.value) return
  active.value = edge(1)
  scrollTop.value = 0
  if (list.value) list.value.scrollTop = 0
  await nextTick()
  positionPopup()
}, { flush: 'sync' })
watch(unavailable, value => { if (value) close() })
onBeforeUnmount(close)
</script>

<template>
  <div ref="root" class="app-select" :class="[{ 'is-compact': compact, 'is-open': opened, 'is-disabled': unavailable }, $attrs.class]" :style="$attrs.style">
    <input
      v-if="editable"
      :id="controlId"
      ref="control"
      class="select-control select-input"
      role="combobox"
      type="text"
      :aria-label="ariaLabel"
      :aria-expanded="opened"
      :aria-controls="opened ? listId : undefined"
      :aria-activedescendant="activeId"
      aria-autocomplete="list"
      aria-haspopup="listbox"
      :aria-busy="loading || undefined"
      :disabled="unavailable"
      :value="inputValue"
      :placeholder="opened && !customValue ? t('common.select.search') : (placeholder ?? t('common.select.placeholder'))"
      autocomplete="off"
      spellcheck="false"
      @input="onInput"
      @click="onClick"
      @keydown="onKeydown"
      @blur="close"
    />
    <button
      v-else
      :id="controlId"
      ref="control"
      class="select-control select-button"
      type="button"
      role="combobox"
      :aria-label="ariaLabel"
      :aria-expanded="opened"
      :aria-controls="opened ? listId : undefined"
      :aria-activedescendant="activeId"
      aria-haspopup="listbox"
      :aria-busy="loading || undefined"
      :disabled="unavailable"
      @click="onClick"
      @keydown="onKeydown"
      @blur="close"
    >
      <span class="select-label" :class="{ 'is-placeholder': !selectedLabel }">{{ loading ? t('common.loading') : (selectedLabel || placeholder || t('common.select.placeholder')) }}</span>
    </button>
    <svg class="select-chevron" :class="{ 'is-expanded': opened }" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    <Teleport :to="portalTarget">
      <div v-if="opened" ref="popup" class="select-popup" :style="popupStyle" @mousedown.prevent>
        <div
          :id="listId"
          ref="list"
          class="select-list"
          role="listbox"
          :aria-label="ariaLabel"
          :style="{ maxHeight: `${listHeight}px` }"
          @scroll="scrollTop = ($event.target as HTMLElement).scrollTop"
        >
          <div class="select-spacer" :style="{ height: `${filtered.length * rowHeight}px` }">
            <div
              v-for="{ option, index } in visibleOptions"
              :id="`${listId}-${index}`"
              :key="option.value"
              class="select-option"
              :class="{ 'is-active': index === active, 'is-selected': option.value === modelValue, 'is-disabled': option.disabled }"
              role="option"
              :aria-selected="option.value === modelValue"
              :aria-disabled="option.disabled || undefined"
              :aria-posinset="index + 1"
              :aria-setsize="filtered.length"
              :title="option.label"
              :style="{ top: `${index * rowHeight}px`, height: `${rowHeight}px` }"
              @pointermove="!option.disabled && (active = index)"
              @click.stop="choose(index)"
            >
              <span class="select-option-label">{{ option.label }}</span>
              <svg v-if="option.value === modelValue" class="select-check" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>
            </div>
          </div>
        </div>
        <div v-if="!filtered.length" class="select-empty" role="status">{{ customValue ? t('common.select.customValue') : t('common.select.noResults') }}</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.app-select { position: relative; min-width: 0; width: 100%; font-family: var(--ui-font-family, inherit); font-size: var(--font-md, 13px); }
.select-control { display: block; width: 100%; min-width: 0; box-sizing: border-box; margin: 0; border: 1px solid var(--border); border-radius: 5px; padding: 6px 28px 6px 9px; outline: none; background: var(--bg-primary); color: var(--text-primary); font: inherit; line-height: 1.4; text-align: left; transition: border-color .12s, background .12s, box-shadow .12s; }
.select-button { cursor: pointer; }
.select-label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.select-control:hover:not(:disabled) { border-color: var(--text-muted); }
.select-control:focus-visible, .is-open .select-control { border-color: var(--accent-blue); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-blue) 15%, transparent); }
.select-control::placeholder, .is-placeholder { color: var(--text-muted); }
.is-disabled { opacity: .5; }
.select-control:disabled { cursor: default; }
.select-chevron { position: absolute; right: 9px; top: 50%; margin-top: -6px; color: var(--text-muted); pointer-events: none; transition: transform .12s; }
.select-chevron.is-expanded { transform: rotate(180deg); color: var(--accent-blue); }
.is-compact { width: auto; font-size: var(--font-sm, 12px); }
.is-compact .select-control { padding: 3px 25px 3px 7px; background: var(--bg-surface); border-radius: 4px; }
.select-popup { position: fixed; z-index: 1005; box-sizing: border-box; padding: 4px; background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 8px 24px rgb(0 0 0 / 24%); }
.select-list { overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--bg-overlay) transparent; }
.select-spacer { position: relative; }
.select-option { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 10px; padding: 0 8px; border-radius: 3px; cursor: pointer; line-height: 1.5; }
.select-option-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: pre; }
.select-option.is-active { background: color-mix(in srgb, var(--accent-blue) 14%, transparent); }
.select-option.is-selected { color: var(--accent-blue); }
.select-option.is-disabled { opacity: .4; cursor: default; }
.select-check { flex-shrink: 0; }
.select-empty { padding: 9px 8px; color: var(--text-muted); font-size: inherit; line-height: 1.5; }
@media (prefers-reduced-motion: reduce) { .select-control, .select-chevron { transition: none; } }
</style>
