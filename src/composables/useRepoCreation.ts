import { ref } from 'vue'

// 单例响应式状态：把"添加仓库"菜单和两个对话框挂到 App.vue 顶层，
// 各处入口（AppToolbar 的「打开」chevron、AppSidebar 的 +）只需调用方法。
// 同一时间只允许一个 dialog 显示。
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)

const cloneDialogVisible = ref(false)
const initDialogVisible = ref(false)

export function useRepoCreation() {
  /** 在指定锚点元素下方弹出菜单（按钮 rect 的左下角） */
  function showMenuAt(anchor: HTMLElement | null) {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    menuX.value = Math.round(rect.left)
    menuY.value = Math.round(rect.bottom + 4)
    menuVisible.value = true
  }

  function hideMenu() {
    menuVisible.value = false
  }

  function openCloneDialog() {
    menuVisible.value = false
    initDialogVisible.value = false
    cloneDialogVisible.value = true
  }

  function openInitDialog() {
    menuVisible.value = false
    cloneDialogVisible.value = false
    initDialogVisible.value = true
  }

  function closeCloneDialog() {
    cloneDialogVisible.value = false
  }

  function closeInitDialog() {
    initDialogVisible.value = false
  }

  return {
    // state
    menuVisible,
    menuX,
    menuY,
    cloneDialogVisible,
    initDialogVisible,
    // actions
    showMenuAt,
    hideMenu,
    openCloneDialog,
    openInitDialog,
    closeCloneDialog,
    closeInitDialog,
  }
}
