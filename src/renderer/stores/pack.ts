import { defineStore, getActivePinia } from 'pinia'
import { computed, ref } from 'vue'
import type {
  CategorySummary,
  ExportReport,
  PackSummary,
  TextureEntry,
  TextureStatus
} from '@shared/model/pack'
import { call } from '../services/ipc'
import { useJobsStore } from './jobs'

export type StatusFilter = 'all' | 'changed' | TextureStatus

export const ALL_CATEGORIES = '__all__'

/**
 * One store per open pack tab (`pack/<id>`), so each tab keeps its own category, filters, zoom and selection.
 * Disposed when the tab closes.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function usePackStore(packId: string) {
  return defineStore(`pack/${packId}`, () => {
    const summary = ref<PackSummary | null>(null)
    const textures = ref<TextureEntry[]>([])
    const categories = ref<CategorySummary[]>([])
    const loading = ref(false)
    const loaded = ref(false)

    /** null = category overview (navigator); ALL_CATEGORIES = every texture. */
    const category = ref<string | null>(null)
    const search = ref('')
    const statusFilter = ref<StatusFilter>('all')
    const zoom = ref(64)
    const selection = ref<Set<string>>(new Set())
    /** Texture open in the 1:1 editor (null = grid/overview). */
    const editing = ref<string | null>(null)
    const anchor = ref<string | null>(null)
    /** Grid scroll position, kept while the editor replaces the grid (and across tab switches). */
    const gridScroll = ref(0)
    /** Last texture shown in the editor, so the grid can bring its tile into view on return. */
    const lastEdited = ref<string | null>(null)
    /** Navigation agent panel next to the grid. */
    const aiPanel = ref(false)

    const changedCount = computed(() => textures.value.filter((t) => t.status !== 'vanilla').length)

    const visible = computed<TextureEntry[]>(() => {
      const q = search.value.trim().toLowerCase()
      return textures.value.filter((t) => {
        if (
          category.value &&
          category.value !== ALL_CATEGORIES &&
          !t.categories.includes(category.value)
        ) {
          return false
        }
        if (statusFilter.value === 'changed' && t.status === 'vanilla') return false
        if (
          statusFilter.value !== 'all' &&
          statusFilter.value !== 'changed' &&
          t.status !== statusFilter.value
        ) {
          return false
        }
        return !q || t.name.toLowerCase().includes(q) || t.path.toLowerCase().includes(q)
      })
    })

    async function load(): Promise<void> {
      loading.value = true
      try {
        const [s, t, c] = await Promise.all([
          call('pack.get', { packId }),
          call('pack.textures', { packId }),
          call('pack.categories', { packId })
        ])
        summary.value = s
        textures.value = t
        categories.value = c
        const paths = new Set(t.map((x) => x.path))
        selection.value = new Set([...selection.value].filter((p) => paths.has(p)))
        loaded.value = true
      } finally {
        loading.value = false
      }
    }

    function openCategory(id: string | null): void {
      category.value = id
      gridScroll.value = 0
      clearSelection()
    }

    /** Click: select one. Ctrl/Cmd: toggle. Shift: range from the anchor within the visible list. */
    function select(path: string, mode: 'single' | 'toggle' | 'range'): void {
      const next = new Set(mode === 'single' ? [] : selection.value)
      if (mode === 'range' && anchor.value) {
        const list = visible.value.map((t) => t.path)
        const a = list.indexOf(anchor.value)
        const b = list.indexOf(path)
        if (a >= 0 && b >= 0) {
          const [from, to] = a < b ? [a, b] : [b, a]
          for (const p of list.slice(from, to + 1)) next.add(p)
          selection.value = next
          return
        }
      }
      if (mode === 'toggle' && next.has(path)) next.delete(path)
      else next.add(path)
      anchor.value = path
      selection.value = next
    }

    function selectAll(): void {
      selection.value = new Set(visible.value.map((t) => t.path))
    }

    function clearSelection(): void {
      selection.value = new Set()
      anchor.value = null
    }

    function openEditor(path: string): void {
      editing.value = path
      lastEdited.value = path
    }

    function closeEditor(): void {
      if (editing.value) lastEdited.value = editing.value
      editing.value = null
    }

    async function exportPack(targetVersion: string): Promise<ExportReport | null> {
      try {
        return await call('pack.export', { packId, targetVersion })
      } finally {
        useJobsStore().clear('pack.export')
      }
    }

    return {
      packId,
      summary,
      textures,
      categories,
      loading,
      loaded,
      category,
      search,
      statusFilter,
      zoom,
      selection,
      editing,
      gridScroll,
      lastEdited,
      aiPanel,
      changedCount,
      visible,
      load,
      openCategory,
      select,
      selectAll,
      clearSelection,
      openEditor,
      closeEditor,
      exportPack
    }
  })()
}

export type PackStore = ReturnType<typeof usePackStore>

/** Releases a closed tab's store and its state. */
export function disposePackStore(packId: string): void {
  const pinia = getActivePinia()
  if (!pinia) return
  const id = `pack/${packId}`
  const store = (pinia as unknown as { _s: Map<string, { $dispose(): void }> })._s.get(id)
  store?.$dispose()
  delete pinia.state.value[id]
}
