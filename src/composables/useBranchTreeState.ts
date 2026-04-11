import { ref, watch } from 'vue'

const STORAGE_KEY = 'gitui.branchTree.collapsed'

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
 * 管理分支树的折叠状态（按 folder path 记录被折叠的节点），持久化到 localStorage。
 * 默认全部展开：只有被显式折叠过的 path 才进入 collapsed 集合。
 *
 * 模块级 singleton —— 整个应用共享同一份折叠状态，
 * Sidebar 或其他地方多次调用 useBranchTreeState() 得到同一个 reactive。
 */
const collapsed = ref<Set<string>>(loadCollapsed())

watch(
  collapsed,
  (s) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(s)))
  },
  { deep: true },
)

export function useBranchTreeState() {
  function isCollapsed(path: string): boolean {
    return collapsed.value.has(path)
  }

  function toggle(path: string) {
    const next = new Set(collapsed.value)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    collapsed.value = next
  }

  function collapse(path: string) {
    if (!collapsed.value.has(path)) {
      const next = new Set(collapsed.value)
      next.add(path)
      collapsed.value = next
    }
  }

  function expand(path: string) {
    if (collapsed.value.has(path)) {
      const next = new Set(collapsed.value)
      next.delete(path)
      collapsed.value = next
    }
  }

  return { collapsed, isCollapsed, toggle, collapse, expand }
}
