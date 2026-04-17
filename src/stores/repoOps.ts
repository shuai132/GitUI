import { defineStore } from 'pinia'
import { ref } from 'vue'

// 工具栏中与具体仓库绑定的"操作进行中"标志集中管理。
// 语义是按 repoId 隔离：A 正在 push 切到 B，B 的按钮不应转；切回 A 若
// 后端仍未返回，A 的按钮继续转。调用方要在开始操作时锁住当时的 repoId，
// finally 清除时用同一个 id，避免 await 期间用户切仓库造成误清。

export type OpKind = 'pull' | 'push' | 'fetch' | 'stash' | 'pop' | 'gc'

type BusyBucket = Record<OpKind, boolean>

function makeBucket(): BusyBucket {
  return { pull: false, push: false, fetch: false, stash: false, pop: false, gc: false }
}

// 共享的"全 false"快照。getBusy 在仓库未记录过或 repoId 为 null 时返回它，
// 避免每次生成新对象导致 computed 的依赖误触发。
const EMPTY_BUCKET: Readonly<BusyBucket> = Object.freeze(makeBucket())

export const useRepoOpsStore = defineStore('repoOps', () => {
  const busyMap = ref<Record<string, BusyBucket>>({})

  function getBusy(repoId: string | null | undefined): BusyBucket {
    if (!repoId) return EMPTY_BUCKET
    return busyMap.value[repoId] ?? EMPTY_BUCKET
  }

  function setBusy(repoId: string, op: OpKind, value: boolean) {
    let bucket = busyMap.value[repoId]
    if (!bucket) {
      bucket = makeBucket()
      busyMap.value[repoId] = bucket
    }
    bucket[op] = value
  }

  function clearRepo(repoId: string) {
    delete busyMap.value[repoId]
  }

  return { getBusy, setBusy, clearRepo }
})
