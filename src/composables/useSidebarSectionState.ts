import { ref, watch } from 'vue'

const STORAGE_KEY = 'gitui.sidebar.collapsed'

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) return new Set(arr)
  } catch {
    /* ignore */
  }
  return new Set()
}

/**
 * 管理侧边栏 section 级折叠状态，持久化到 localStorage。
 * 默认全部展开：只有被显式折叠过的 section ID 才进入 collapsed 集合。
 *
 * Section ID: "local-branches" | "stash" | "submodules" | "remote"
 *
 * 模块级 singleton —— 整个应用共享同一份折叠状态。
 */
const collapsed = ref<Set<string>>(loadCollapsed())

watch(
  collapsed,
  (s) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(s)))
  },
  { deep: true },
)

export function useSidebarSectionState() {
  function isCollapsed(id: string): boolean {
    return collapsed.value.has(id)
  }

  function toggle(id: string) {
    const next = new Set(collapsed.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    collapsed.value = next
  }

  function collapse(id: string) {
    if (!collapsed.value.has(id)) {
      const next = new Set(collapsed.value)
      next.add(id)
      collapsed.value = next
    }
  }

  function expand(id: string) {
    if (collapsed.value.has(id)) {
      const next = new Set(collapsed.value)
      next.delete(id)
      collapsed.value = next
    }
  }

  return { isCollapsed, toggle, collapse, expand }
}
