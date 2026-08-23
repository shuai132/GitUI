export const CLONE_PARENT_DIR_KEY = 'gitui.clone.parentDir'

type ClonePreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function loadCloneParentDir(storage: ClonePreferenceStorage = localStorage): string {
  return storage.getItem(CLONE_PARENT_DIR_KEY) ?? ''
}

export function saveCloneParentDir(
  parentDir: string,
  storage: ClonePreferenceStorage = localStorage,
) {
  if (parentDir.trim()) {
    storage.setItem(CLONE_PARENT_DIR_KEY, parentDir)
  } else {
    storage.removeItem(CLONE_PARENT_DIR_KEY)
  }
}
