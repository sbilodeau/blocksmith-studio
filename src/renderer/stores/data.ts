import { defineStore, getActivePinia } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { DataKind, DataIds } from '@shared/datapack'
import { dataContext } from '@shared/datapack'
import type { DataEntry, DataStatus } from '@shared/model/data'
import { call } from '../services/ipc'

export type DataStatusFilter = 'all' | 'changed' | DataStatus

/** Data browser kinds in sidebar order. */
export const DATA_SECTIONS: readonly DataKind[] = [
  'recipe',
  'loot_table',
  'tag',
  'advancement',
  'function',
  'other'
]

/**
 * Data files of one open pack tab (`data/<id>`, PLAN M10): the list shown by the data browser, its filters, and the
 * file open in the JSON editor. Disposed when the tab closes.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useDataStore(packId: string) {
  return defineStore(`data/${packId}`, () => {
    // Thousands of plain entries: no deep reactivity needed.
    const entries = shallowRef<DataEntry[]>([])
    const ids = shallowRef<DataIds>({ items: [], blocks: [], tags: {} })
    const vanillaData = ref(true)
    const loading = ref(false)
    const loaded = ref(false)
    const kind = ref<DataKind>('recipe')
    const search = ref('')
    const statusFilter = ref<DataStatusFilter>('all')
    /** File open in the editor (null = the list). */
    const editing = ref<string | null>(null)

    const context = computed(() => dataContext(ids.value))

    const counts = computed(() => {
      const out = Object.fromEntries(
        DATA_SECTIONS.map((k) => [k, { count: 0, changed: 0 }])
      ) as Record<DataKind, { count: number; changed: number }>
      for (const e of entries.value) {
        out[e.kind].count++
        if (e.status !== 'vanilla') out[e.kind].changed++
      }
      return out
    })

    const changedCount = computed(() => entries.value.filter((e) => e.status !== 'vanilla').length)

    const visible = computed<DataEntry[]>(() => {
      const q = search.value.trim().toLowerCase()
      return entries.value.filter((e) => {
        if (e.kind !== kind.value) return false
        if (statusFilter.value === 'changed' && e.status === 'vanilla') return false
        if (
          statusFilter.value !== 'all' &&
          statusFilter.value !== 'changed' &&
          e.status !== statusFilter.value
        ) {
          return false
        }
        return !q || e.id.includes(q) || e.path.includes(q)
      })
    })

    async function load(): Promise<void> {
      loading.value = true
      try {
        const list = await call('data.list', { packId })
        entries.value = list.entries
        ids.value = list.ids
        vanillaData.value = list.vanillaData
        loaded.value = true
      } finally {
        loading.value = false
      }
    }

    function entry(path: string): DataEntry | undefined {
      return entries.value.find((e) => e.path === path)
    }

    function open(path: string): void {
      editing.value = path
    }

    function close(): void {
      editing.value = null
    }

    function setKind(next: DataKind): void {
      kind.value = next
      editing.value = null
    }

    /** Creates a file and opens it (the list reloads on 'packs.changed'). */
    async function create(path: string, text: string): Promise<DataEntry> {
      const created = await call('data.create', { packId, path, text })
      entries.value = [...entries.value.filter((e) => e.path !== path), created]
      kind.value = created.kind
      editing.value = path
      return created
    }

    async function save(path: string, text: string): Promise<DataEntry> {
      const saved = await call('data.save', { packId, path, text })
      entries.value = entries.value.map((e) => (e.path === path ? saved : e))
      return saved
    }

    /** Removes the pack's copy: back to vanilla, or gone for an added file. */
    async function remove(path: string): Promise<void> {
      await call('data.delete', { packId, path })
      const e = entry(path)
      if (e?.status === 'added') {
        entries.value = entries.value.filter((x) => x.path !== path)
        if (editing.value === path) editing.value = null
      } else {
        entries.value = entries.value.map((x) =>
          x.path === path ? { ...x, status: 'vanilla' } : x
        )
      }
    }

    return {
      packId,
      entries,
      ids,
      vanillaData,
      loading,
      loaded,
      kind,
      search,
      statusFilter,
      editing,
      context,
      counts,
      changedCount,
      visible,
      load,
      entry,
      open,
      close,
      setKind,
      create,
      save,
      remove
    }
  })()
}

export type DataStore = ReturnType<typeof useDataStore>

/** Releases a closed tab's data store. */
export function disposeDataStore(packId: string): void {
  const pinia = getActivePinia()
  if (!pinia) return
  const id = `data/${packId}`
  const store = (pinia as unknown as { _s: Map<string, { $dispose(): void }> })._s.get(id)
  store?.$dispose()
  delete pinia.state.value[id]
}
