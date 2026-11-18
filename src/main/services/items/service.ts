import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { namespaceFor } from '@shared/datapack/paths'
import { createImage } from '@shared/image/basics'
import { encodePng } from '@shared/image/png'
import {
  ITEM_DEF_RE,
  ITEMS_DIR,
  LATEST_ITEM_FORMAT,
  armorTexturePath,
  itemChanges,
  itemDefPath,
  itemFormatFor,
  itemTagsFrom,
  itemTexturePath,
  parseItemFiles,
  recipesUsing,
  wornTexturePreset,
  type CustomItem,
  type ItemFormat
} from '@shared/items'
import type { HistoryEntry } from '@shared/model/history'
import type {
  ItemCatalog,
  ItemContext,
  ItemList,
  ItemSummary,
  TextureSource,
  VanillaItemInfo
} from '@shared/model/items'
import type { VanillaStore } from '../contracts'
import { AppErrorException } from '../../ipc/registry'
import type { HistoryService } from '../history'
import { assertInsidePack, readOptional, resolvePackFile } from '../history/pack-files'
import type { DataService } from '../packs/data'
import { parseJson } from '../packs/mcmeta'
import { isValidTexturePng } from '../packs/textures-edit'
import type { PackLocation } from '../packs/project'
import type { PackService } from '../packs/service'

/** Error codes of the item service (i18n: `errors.<code>`). */
export const ItemErrorCode = {
  /** Custom items need both a resource and a data part. */
  needsCombined: 'items.needsCombined',
  /** No definition with that id (params: id). */
  notFound: 'items.notFound',
  /** items.create or a rename onto an id the pack already has (params: id). */
  exists: 'items.exists',
  /** The definition is not valid (params: id). */
  invalid: 'items.invalid',
  /** A lang file the item writes into is not a JSON object (params: path). */
  invalidLang: 'items.invalidLang',
  /** textureFrom is not a texture of vanilla or the pack (params: path). */
  invalidTexture: 'items.invalidTexture'
} as const

/** One step of a change set: write (create or replace, renaming when `previousId` differs) or delete. */
export type ItemOperation =
  | {
      op: 'write'
      item: CustomItem
      /** Id of the definition being replaced (rename); omit for a new item. */
      previousId?: string
      /** Texture of a new item (vanilla or pack path; null = blank 16x16). Ignored when the texture exists. */
      textureFrom?: TextureSource
    }
  | { op: 'delete'; id: string }

export interface ItemServiceDeps {
  packs: Pick<PackService, 'locate'>
  vanilla: Pick<VanillaStore, 'getIndex' | 'prepareData' | 'resolveFile' | 'getVersion'>
  history: Pick<HistoryService, 'apply'>
  data: Pick<DataService, 'names'>
  notifyChanged: (packId: string) => void
}

export interface ItemService {
  list(packId: string): Promise<ItemList>
  read(packId: string, id: string): Promise<CustomItem>
  /** Every valid definition of the pack. */
  all(packId: string): Promise<CustomItem[]>
  create(packId: string, item: CustomItem, textureFrom: TextureSource): Promise<ItemSummary>
  /** Saves `item` over the definition `id` (a different item.id renames it, textures included). */
  save(packId: string, id: string, item: CustomItem): Promise<ItemSummary>
  remove(packId: string, id: string): Promise<void>
  /** Writes the generated files again from the definition (Pack Doctor fix). */
  regenerate(packId: string, id: string): Promise<void>
  /** Several operations as ONE history entry (AI plans). Null when nothing changes. */
  applyMany(
    packId: string,
    operations: readonly ItemOperation[],
    change: { source: HistoryEntry['source']; label: HistoryEntry['label'] }
  ): Promise<HistoryEntry | null>
  /** Vanilla items (names, icons) and item tags of the pack's version. */
  catalog(packId: string): Promise<ItemCatalog>
  /** Vanilla recipes using `base` as an ingredient. */
  context(packId: string, base: string): Promise<ItemContext>
  /** The item whose texture (or worn texture) is `path`, if any (editor agent context). */
  forTexture(packId: string, path: string): Promise<CustomItem | null>
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()
const BLANK_SIZE = 16
/** Worn armor textures are 64x32 sheets. */
const WORN_SIZE = { width: 64, height: 32 }

function summaryOf(item: CustomItem, hasTexture: boolean): ItemSummary {
  return {
    id: item.id,
    namespace: item.namespace,
    kind: item.kind,
    base: item.base,
    names: item.names,
    texture: itemTexturePath(item),
    hasTexture
  }
}

/** Vanilla data parsed once per version (recipes and item tags for "used by" warnings). */
interface VanillaRecipes {
  recipes: Array<{ path: string; json: unknown }>
  tags: Map<string, string[]>
}

export function createItemService(deps: ItemServiceDeps): ItemService {
  const recipeCache = new Map<string, Promise<VanillaRecipes>>()
  const catalogCache = new Map<string, Promise<ItemCatalog>>()

  async function requireLocation(packId: string): Promise<PackLocation> {
    const location = await deps.packs.locate(packId)
    if (!location) throw new AppErrorException('packs.notFound', { packId })
    return location
  }

  function formatOf(location: PackLocation): ItemFormat {
    const v = deps.vanilla.getVersion(location.project.authoringVersion)
    return v ? itemFormatFor(v) : LATEST_ITEM_FORMAT
  }

  function packFile(location: PackLocation, path: string): string {
    const abs = resolvePackFile(location.folder, path)
    if (!abs) throw new AppErrorException('packs.unsafePath', { path })
    return abs
  }

  async function readPack(location: PackLocation, path: string): Promise<Uint8Array | null> {
    return readOptional(resolvePackFile(location.folder, path))
  }

  async function loadItems(
    location: PackLocation
  ): Promise<{ items: CustomItem[]; invalid: string[] }> {
    const dir = join(location.folder, ...ITEMS_DIR.split('/'))
    const names = await fs.readdir(dir).catch(() => [] as string[])
    const files: Array<{ path: string; text: string }> = []
    for (const name of names.sort()) {
      const path = `${ITEMS_DIR}/${name}`
      if (!ITEM_DEF_RE.test(path)) continue
      const bytes = await readPack(location, path)
      if (bytes) files.push({ path, text: decoder.decode(bytes) })
    }
    return parseItemFiles(files)
  }

  function requireCombined(location: PackLocation): void {
    if (location.project.kind !== 'combined')
      throw new AppErrorException(ItemErrorCode.needsCombined)
  }

  /**
   * PNG of a texture source: pack file first, then vanilla of the pack's version; a blank image for null. With
   * `blank`, a missing source gives a blank image of that size instead of an error (preset sources).
   */
  async function texturePng(
    location: PackLocation,
    source: TextureSource | undefined,
    blank?: { width: number; height: number }
  ): Promise<Uint8Array> {
    const empty = (): Uint8Array =>
      encodePng(createImage(blank?.width ?? BLANK_SIZE, blank?.height ?? BLANK_SIZE))
    if (!source) return empty()
    const valid = /^assets\/[a-z0-9_.-]+\/textures\/[a-z0-9_./-]+\.png$/.test(source)
    const png = valid
      ? ((await readPack(location, source)) ??
        (await readOptional(deps.vanilla.resolveFile(location.project.authoringVersion, source))))
      : null
    if (png && isValidTexturePng(png)) return png
    if (blank) return empty()
    throw new AppErrorException(ItemErrorCode.invalidTexture, { path: source })
  }

  async function buildChanges(
    location: PackLocation,
    operations: readonly ItemOperation[]
  ): Promise<Array<{ path: string; after: Uint8Array | null }>> {
    const format = formatOf(location)
    let { items } = await loadItems(location)
    /** Pack state as the operations see it (earlier operations included). */
    const pending = new Map<string, Uint8Array | null>()
    const current = async (path: string): Promise<Uint8Array | null> =>
      pending.has(path) ? pending.get(path)! : readPack(location, path)
    const langCache = new Map<string, Record<string, string> | null>()

    for (const operation of operations) {
      const previousId = operation.op === 'delete' ? operation.id : operation.previousId
      const before = previousId ? (items.find((i) => i.id === previousId) ?? null) : null
      if (previousId && !before)
        throw new AppErrorException(ItemErrorCode.notFound, { id: previousId })
      const after = operation.op === 'write' ? operation.item : null
      if (after && after.id !== previousId && items.some((i) => i.id === after.id)) {
        throw new AppErrorException(ItemErrorCode.exists, { id: after.id })
      }
      // Lang files are read up front: itemChanges needs them synchronously.
      for (const item of [before, after]) {
        if (!item) continue
        for (const lang of new Set([
          ...Object.keys(item.names),
          ...item.lore.flatMap(Object.keys)
        ])) {
          const path = `assets/${item.namespace}/lang/${lang}.json`
          if (langCache.has(path)) continue
          const bytes = await current(path)
          const json = bytes ? parseJson(bytes) : null
          if (bytes && (!json || typeof json !== 'object' || Array.isArray(json))) {
            throw new AppErrorException(ItemErrorCode.invalidLang, { path })
          }
          langCache.set(path, (json as Record<string, string> | null) ?? null)
        }
      }
      const others = items.filter((i) => i.id !== previousId)
      const changes = itemChanges({
        before,
        after,
        others,
        format,
        readLang: (path) => langCache.get(path) ?? null
      })
      for (const c of changes) {
        pending.set(c.path, c.text === null ? null : encoder.encode(c.text))
        if (/\/lang\/[^/]+\.json$/.test(c.path)) {
          langCache.set(
            c.path,
            c.text === null ? null : (JSON.parse(c.text) as Record<string, string>)
          )
        }
      }

      // Textures: kept on save, moved on rename, created for a new item, removed on delete.
      const textures = (item: CustomItem | null): Array<string | null> =>
        item ? [itemTexturePath(item), armorTexturePath(item)] : [null, null]
      const [oldTexture, oldWorn] = textures(before)
      const [newTexture, newWorn] = textures(after)
      for (const [from, to, source, blank] of [
        [
          oldTexture,
          newTexture,
          operation.op === 'write' ? operation.textureFrom : undefined,
          undefined
        ],
        [
          oldWorn,
          newWorn,
          after?.armor ? wornTexturePreset(after.armor.slot) : undefined,
          WORN_SIZE
        ]
      ] as const) {
        const fromBytes = from ? await current(from) : null
        if (to && !(await current(to))) {
          pending.set(to, fromBytes ?? (await texturePng(location, source ?? null, blank)))
        }
        if (from && from !== to && fromBytes) pending.set(from, null)
      }

      items = after ? [...others, after] : others
    }

    const out: Array<{ path: string; after: Uint8Array | null }> = []
    for (const [path, after] of pending) {
      const abs = packFile(location, path)
      await assertInsidePack(location.folder, abs, path)
      if (after === null && !(await readOptional(abs))) continue
      out.push({ path, after })
    }
    return out
  }

  async function apply(
    location: PackLocation,
    operations: readonly ItemOperation[],
    change: { source: HistoryEntry['source']; label: HistoryEntry['label'] }
  ): Promise<HistoryEntry | null> {
    requireCombined(location)
    const changes = await buildChanges(location, operations)
    if (changes.length === 0) return null
    try {
      return await deps.history.apply(location.id, { ...change, changes })
    } finally {
      deps.notifyChanged(location.id)
    }
  }

  async function summary(location: PackLocation, item: CustomItem): Promise<ItemSummary> {
    return summaryOf(item, (await readPack(location, itemTexturePath(item))) !== null)
  }

  async function vanillaRecipes(version: string): Promise<VanillaRecipes> {
    let cached = recipeCache.get(version)
    if (!cached) {
      cached = (async () => {
        await deps.vanilla.prepareData(version)
        const index = await deps.vanilla.getIndex(version)
        const recipes: VanillaRecipes['recipes'] = []
        const tagFiles: Array<{ path: string; json: unknown }> = []
        for (const path of Object.keys(index?.entries ?? {})) {
          const recipe = path.startsWith('data/minecraft/recipe/')
          if (!recipe && !path.startsWith('data/minecraft/tags/item/')) continue
          const bytes = await readOptional(deps.vanilla.resolveFile(version, path))
          const json = bytes ? parseJson(bytes) : undefined
          if (json === undefined) continue
          ;(recipe ? recipes : tagFiles).push({ path, json })
        }
        return { recipes, tags: itemTagsFrom(tagFiles) }
      })()
      recipeCache.set(version, cached)
      cached
        .then((r) => r.recipes.length === 0 && recipeCache.delete(version))
        .catch(() => recipeCache.delete(version))
    }
    return cached
  }

  /** Texture of a vanilla item's icon: items/<id>.json -> first model -> layer0 (or a texture of the same name). */
  async function iconOf(
    version: string,
    name: string,
    paths: ReadonlySet<string>
  ): Promise<string | undefined> {
    const readJson = async (path: string): Promise<unknown> => {
      const bytes = await readOptional(deps.vanilla.resolveFile(version, path))
      return bytes ? parseJson(bytes) : undefined
    }
    const findModel = (v: unknown): string | undefined => {
      if (!v || typeof v !== 'object') return undefined
      if (Array.isArray(v)) {
        for (const x of v) {
          const m = findModel(x)
          if (m) return m
        }
        return undefined
      }
      const o = v as Record<string, unknown>
      if (o['type'] === 'minecraft:model' && typeof o['model'] === 'string') return o['model']
      for (const key of ['fallback', 'model', 'on_false', 'cases', 'entries']) {
        const m = findModel(o[key])
        if (m) return m
      }
      return undefined
    }
    const model = findModel(await readJson(`assets/minecraft/items/${name}.json`))
    if (model) {
      const modelPath = model.replace(/^minecraft:/, '')
      const json = (await readJson(`assets/minecraft/models/${modelPath}.json`)) as
        { textures?: Record<string, unknown> } | undefined
      const layer0 = json?.textures?.['layer0']
      if (typeof layer0 === 'string') {
        const path = `assets/minecraft/textures/${layer0.replace(/^minecraft:/, '')}.png`
        if (paths.has(path)) return path
      }
    }
    for (const folder of ['item', 'block']) {
      const path = `assets/minecraft/textures/${folder}/${name}.png`
      if (paths.has(path)) return path
    }
    return undefined
  }

  return {
    async list(packId) {
      const location = await requireLocation(packId)
      const { items, invalid } = await loadItems(location)
      return {
        items: await Promise.all(items.map((i) => summary(location, i))),
        invalid,
        namespace: items[0]?.namespace ?? namespaceFor(location.project.name)
      }
    },

    async read(packId, id) {
      const location = await requireLocation(packId)
      const bytes = /^[a-z0-9_]{1,64}$/.test(id) ? await readPack(location, itemDefPath(id)) : null
      if (!bytes) throw new AppErrorException(ItemErrorCode.notFound, { id })
      const { items } = parseItemFiles([{ path: itemDefPath(id), text: decoder.decode(bytes) }])
      if (!items[0]) throw new AppErrorException(ItemErrorCode.invalid, { id })
      return items[0]
    },

    async all(packId) {
      return (await loadItems(await requireLocation(packId))).items
    },

    async create(packId, item, textureFrom) {
      const location = await requireLocation(packId)
      const { items } = await loadItems(location)
      if (items.some((i) => i.id === item.id) || (await readPack(location, itemDefPath(item.id)))) {
        throw new AppErrorException(ItemErrorCode.exists, { id: item.id })
      }
      await apply(location, [{ op: 'write', item, textureFrom }], {
        source: 'editor',
        label: { key: 'createItem', params: { name: item.names['en_us'] ?? item.id } }
      })
      return summary(location, item)
    },

    async save(packId, id, item) {
      const location = await requireLocation(packId)
      const label: HistoryEntry['label'] =
        id === item.id
          ? { key: 'saveItem', params: { name: item.names['en_us'] ?? item.id } }
          : { key: 'renameItem', params: { from: id, to: item.id } }
      await apply(location, [{ op: 'write', item, previousId: id }], { source: 'editor', label })
      return summary(location, item)
    },

    async remove(packId, id) {
      const location = await requireLocation(packId)
      await apply(location, [{ op: 'delete', id }], {
        source: 'editor',
        label: { key: 'deleteItem', params: { name: id } }
      })
    },

    async regenerate(packId, id) {
      const location = await requireLocation(packId)
      const item = (await loadItems(location)).items.find((i) => i.id === id)
      if (!item) throw new AppErrorException(ItemErrorCode.notFound, { id })
      await apply(location, [{ op: 'write', item, previousId: id }], {
        source: 'editor',
        label: { key: 'regenerateItem', params: { name: item.names['en_us'] ?? id } }
      })
    },

    async applyMany(packId, operations, change) {
      if (operations.length === 0) return null
      return apply(await requireLocation(packId), operations, change)
    },

    async catalog(packId) {
      const location = await requireLocation(packId)
      const version = location.project.authoringVersion
      let cached = catalogCache.get(version)
      if (!cached) {
        cached = (async () => {
          const index = await deps.vanilla.getIndex(version)
          const paths = new Set(Object.keys(index?.entries ?? {}))
          const names = await deps.data.names(location.id)
          const items: VanillaItemInfo[] = []
          for (const path of [...paths].sort()) {
            const m = /^assets\/minecraft\/items\/([a-z0-9_]+)\.json$/.exec(path)
            if (!m) continue
            const id = `minecraft:${m[1]}`
            const icon = await iconOf(version, m[1]!, paths)
            items.push({ id, ...(names[id] ? { name: names[id] } : {}), ...(icon ? { icon } : {}) })
          }
          const { tags } = await vanillaRecipes(version)
          return { version, items, tags: [...tags.keys()].map((t) => `#${t}`).sort() }
        })()
        catalogCache.set(version, cached)
        cached
          .then((c) => c.items.length === 0 && catalogCache.delete(version))
          .catch(() => catalogCache.delete(version))
      }
      return cached
    },

    async context(packId, base) {
      const location = await requireLocation(packId)
      const { recipes, tags } = await vanillaRecipes(location.project.authoringVersion)
      return { baseRecipeUses: recipesUsing(base, recipes, tags) }
    },

    async forTexture(packId, path) {
      const location = await requireLocation(packId)
      const { items } = await loadItems(location)
      return items.find((i) => itemTexturePath(i) === path || armorTexturePath(i) === path) ?? null
    }
  }
}
