import { defineStore, getActivePinia } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { CustomItemSchema, type CustomItem, type CustomItemInput } from '@shared/items/schema'
import type { ItemCatalog, ItemSummary, TextureSource } from '@shared/model/items'
import { vanillaAssetUrl } from '@shared/assets'
import { IpcError, call, toPlain } from '../services/ipc'

/** An item picker entry added on top of the vanilla items (the pack's own items, as texture sources). */
export interface PickerExtra {
  id: string
  name?: string
  /** Pack texture path of its icon. */
  icon?: string
}

/** Name of a custom item in the UI language (English when there is no translation). */
export function itemDisplayName(names: Record<string, string>, locale: string): string {
  return (locale === 'fr' ? names['fr_fr'] : undefined) ?? names['en_us'] ?? ''
}

/** JSON with sorted keys (undefined dropped): compares a form draft with the saved definition. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
        )
      : v
  )
}

/**
 * Custom items of one open pack tab (`items/<id>`, PLAN M14): the Items list, the vanilla item catalog (pickers),
 * and the item open on the item page with its unsaved form draft. The draft lives here, so it survives the pixel
 * editor replacing the item page. Disposed when the tab closes.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useItemsStore(packId: string) {
  return defineStore(`items/${packId}`, () => {
    const items = shallowRef<ItemSummary[]>([])
    const invalid = shallowRef<string[]>([])
    /** Namespace of new items. */
    const namespace = ref('')
    const loading = ref(false)
    const loaded = ref(false)
    const catalog = shallowRef<ItemCatalog | null>(null)
    let catalogLoad: Promise<ItemCatalog> | null = null

    /** Id of the item open on the item page (null = the list). */
    const editing = ref<string | null>(null)
    /** The open item as saved (null while it loads). */
    const saved = shallowRef<CustomItem | null>(null)
    /** The form: the definition being edited, possibly invalid. */
    const draft = ref<CustomItemInput | null>(null)
    /** The extra components text does not parse (kept out of the draft until it does). */
    const extraInvalid = ref(false)
    const saving = ref(false)
    /** Bumped whenever the pack's files change: icons and the 3D preview reload. */
    const revision = ref(0)

    const parsed = computed(() =>
      draft.value ? CustomItemSchema.safeParse(toPlain(draft.value)) : null
    )
    const valid = computed(() => !!parsed.value?.success && !extraInvalid.value)
    /** The definition shown by the commands, the preview and the AI: the form when valid, else the saved one. */
    const current = computed<CustomItem | null>(() =>
      parsed.value?.success ? parsed.value.data : saved.value
    )
    const dirty = computed(
      () =>
        !!draft.value &&
        !!saved.value &&
        (extraInvalid.value || stableJson(draft.value) !== stableJson(saved.value))
    )
    const catalogById = computed(
      () => new Map((catalog.value?.items ?? []).map((i) => [i.id, i] as const))
    )

    /** Icon URL of a vanilla item id (catalog loaded), if known. */
    function iconUrl(id: string): string | undefined {
      const c = catalog.value
      const icon = catalogById.value.get(id)?.icon
      return c && icon ? vanillaAssetUrl(c.version, icon) : undefined
    }

    /** English name of a vanilla item id (catalog loaded), if known. */
    function vanillaName(id: string): string | undefined {
      return catalogById.value.get(id)?.name
    }

    async function load(): Promise<void> {
      loading.value = true
      try {
        const list = await call('items.list', { packId })
        items.value = list.items
        invalid.value = list.invalid
        namespace.value = list.namespace
        loaded.value = true
      } finally {
        loading.value = false
      }
    }

    /** Vanilla items and tags of the pack's version, fetched once per tab. */
    async function loadCatalog(): Promise<ItemCatalog> {
      if (catalog.value) return catalog.value
      catalogLoad ??= call('items.catalog', { packId })
        .then((c) => {
          catalog.value = c
          return c
        })
        .catch((err: unknown) => {
          catalogLoad = null
          throw err
        })
      return catalogLoad
    }

    function setSaved(item: CustomItem): void {
      saved.value = item
      draft.value = structuredClone(toPlain(item))
      extraInvalid.value = false
    }

    async function open(id: string): Promise<void> {
      editing.value = id
      saved.value = null
      draft.value = null
      extraInvalid.value = false
      try {
        const item = await call('items.read', { packId, id })
        if (editing.value === id) setSaved(item)
      } catch (err) {
        if (editing.value === id) close()
        throw err
      }
    }

    function close(): void {
      editing.value = null
      saved.value = null
      draft.value = null
      extraInvalid.value = false
    }

    /** Puts a definition in the form, unsaved (AI proposals). */
    function applyToForm(item: CustomItemInput): void {
      draft.value = structuredClone(toPlain(item))
      extraInvalid.value = false
    }

    /** Creates an item and opens its page. */
    async function create(item: CustomItem, textureFrom: TextureSource): Promise<void> {
      await call('items.create', { packId, item, textureFrom })
      revision.value++
      await load()
      await open(item.id)
    }

    /** Saves the form (a different id renames the item). Throws when the form is not valid. */
    async function save(): Promise<CustomItem> {
      const id = editing.value
      const result = parsed.value
      if (!id || !result?.success || extraInvalid.value) {
        throw new IpcError({ code: 'items.invalid', params: { id: id ?? '' } })
      }
      const item = result.data
      saving.value = true
      try {
        await call('items.save', { packId, id, item })
        if (editing.value === id) {
          editing.value = item.id
          setSaved(item)
        }
        revision.value++
        await load()
        return item
      } finally {
        saving.value = false
      }
    }

    async function remove(id: string): Promise<void> {
      await call('items.delete', { packId, id })
      if (editing.value === id) close()
      await load()
    }

    async function regenerate(id: string): Promise<void> {
      await call('items.regenerate', { packId, id })
    }

    /**
     * After the pack's files changed (save, undo, texture edit): reloads the list, and the open item when the form
     * has no unsaved change (an undone creation closes the page).
     */
    async function refresh(): Promise<void> {
      revision.value++
      if (loaded.value) await load()
      const id = editing.value
      if (!id || saving.value || dirty.value || !saved.value) return
      try {
        const item = await call('items.read', { packId, id })
        if (editing.value === id && !dirty.value && !saving.value) setSaved(item)
      } catch (err) {
        if (err instanceof IpcError && err.appError.code === 'items.notFound') {
          if (editing.value === id && !saving.value) close()
          return
        }
        throw err
      }
    }

    return {
      packId,
      items,
      invalid,
      namespace,
      loading,
      loaded,
      catalog,
      catalogById,
      iconUrl,
      vanillaName,
      editing,
      saved,
      draft,
      extraInvalid,
      saving,
      revision,
      parsed,
      valid,
      current,
      dirty,
      load,
      loadCatalog,
      open,
      close,
      applyToForm,
      create,
      save,
      remove,
      regenerate,
      refresh
    }
  })()
}

export type ItemsStore = ReturnType<typeof useItemsStore>

/** Releases a closed tab's items store. */
export function disposeItemsStore(packId: string): void {
  const pinia = getActivePinia()
  if (!pinia) return
  const id = `items/${packId}`
  const store = (pinia as unknown as { _s: Map<string, { $dispose(): void }> })._s.get(id)
  store?.$dispose()
  delete pinia.state.value[id]
}
