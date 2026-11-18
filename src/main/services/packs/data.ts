import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { VANILLA_DATA_RE, collectDataIds, parseDataPath, type DataIds } from '@shared/datapack'
import type { HistoryEntry } from '@shared/model/history'
import { ITEMS_DIR, ITEM_DEF_RE, itemGenerating, parseItemFiles } from '@shared/items'
import {
  MAX_DATA_FILE_BYTES,
  type DataEntry,
  type DataFileData,
  type DataList
} from '@shared/model/data'
import type { VanillaStore } from '../contracts'
import { AppErrorException } from '../../ipc/registry'
import type { HistoryService } from '../history'
import { assertInsidePack, readOptional, resolvePackFile } from '../history/pack-files'
import { parseJson } from './mcmeta'
import { comparePaths, scanFiles, sha256 } from './paths'
import type { PackLocation } from './project'
import type { PackService } from './service'

/** Error codes thrown by the data service (i18n: `errors.<code>`). */
export const DataErrorCode = {
  /** Not data/<ns>/....json|.mcfunction, or invalid characters (params: path). */
  invalidPath: 'data.invalidPath',
  /** Over MAX_DATA_FILE_BYTES. */
  tooLarge: 'data.tooLarge',
  /** data.create on a path the pack or vanilla already has (params: path). */
  exists: 'data.exists',
  /** data.delete on a file the pack does not contain (params: path). */
  notInPack: 'data.notInPack'
} as const

export interface DataServiceDeps {
  packs: Pick<PackService, 'locate'>
  vanilla: Pick<VanillaStore, 'getIndex' | 'prepareData' | 'resolveFile'>
  history: Pick<HistoryService, 'apply'>
  /** Main forwards this as the 'packs.changed' event. */
  notifyChanged: (packId: string) => void
}

export interface DataService {
  /** The pack's data files plus, for a vanilla-based pack, the vanilla ones (recipes, loot tables, tags, advancements). */
  list(packId: string): Promise<DataList>
  /** Item, block and tag ids for validation (vanilla of the authoring version plus the pack's own tags). */
  ids(packId: string): Promise<DataIds>
  read(packId: string, path: string): Promise<DataFileData>
  /**
   * Vanilla's file at `path` for the pack's version, whatever the pack's base (Minecraft merges or replaces it even
   * when the pack started empty); null when vanilla has none. Used by "Explain".
   */
  vanillaText(packId: string, path: string): Promise<string | null>
  /** The pack's own file at `path`; null when the pack does not have it. */
  packText(packId: string, path: string): Promise<string | null>
  /** English item and block names of the pack's version ("minecraft:stone" -> "Stone"), from vanilla's en_us.json. */
  names(packId: string): Promise<Record<string, string>>
  /**
   * Writes a data file as one history entry. A JSON file equal to vanilla's (formatting aside) is removed from the
   * pack instead: Minecraft uses vanilla's.
   */
  save(packId: string, path: string, text: string): Promise<DataEntry>
  /** Creates a new file; refuses a path the pack or vanilla already has (open it instead). */
  create(packId: string, path: string, text: string): Promise<DataEntry>
  /** Removes the pack's copy: back to vanilla for an override, gone for an added file. */
  remove(packId: string, path: string): Promise<void>
  /** Writes several data files as ONE history entry (AI plans). Null when `files` is empty. */
  saveMany(
    packId: string,
    files: ReadonlyArray<{ path: string; text: string }>,
    change: { source: HistoryEntry['source']; label: HistoryEntry['label'] }
  ): Promise<HistoryEntry | null>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** "data/minecraft/recipe/oak_planks.json" -> "oak_planks" */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.(json|mcfunction)$/, '')
}

function sameContent(path: string, a: Uint8Array, b: Uint8Array): boolean {
  if (!path.endsWith('.json')) return decoder.decode(a) === decoder.decode(b)
  const x = parseJson(a)
  const y = parseJson(b)
  return x !== undefined && y !== undefined && isDeepStrictEqual(x, y)
}

/** "item.minecraft.stone_slab" / "block.minecraft.stone" -> "minecraft:stone_slab" / "minecraft:stone". */
const NAME_KEY_RE = /^(?:item|block)\.minecraft\.([a-z0-9_]+)$/

/** Item and block names of an en_us.json (items win over blocks: "Wheat Seeds" rather than "Wheat Crops"). */
export function namesFromLang(lang: unknown): Record<string, string> {
  const names: Record<string, string> = {}
  if (!lang || typeof lang !== 'object') return names
  const entries = Object.entries(lang as Record<string, unknown>).sort(([a], [b]) =>
    a.startsWith('item.') === b.startsWith('item.') ? 0 : a.startsWith('item.') ? -1 : 1
  )
  for (const [key, value] of entries) {
    const m = NAME_KEY_RE.exec(key)
    if (m && typeof value === 'string' && !names[`minecraft:${m[1]}`]) {
      names[`minecraft:${m[1]}`] = value
    }
  }
  return names
}

export function createDataService(deps: DataServiceDeps): DataService {
  /** Names per Minecraft version (en_us.json is ~1 MB). */
  const namesCache = new Map<string, Promise<Record<string, string>>>()
  async function requireLocation(packId: string): Promise<PackLocation> {
    const location = await deps.packs.locate(packId)
    if (!location) throw new AppErrorException('packs.notFound', { packId })
    return location
  }

  /** Validates a data path again (main never trusts the renderer) and returns the pack file path. */
  function dataFile(location: PackLocation, path: string): string {
    const abs = parseDataPath(path) ? resolvePackFile(location.folder, path) : null
    if (!abs) throw new AppErrorException(DataErrorCode.invalidPath, { path })
    return abs
  }

  /** The vanilla file at `path` for vanilla-based packs (vanilla data added first if needed). */
  async function vanillaFile(location: PackLocation, path: string): Promise<string | null> {
    const { project } = location
    if (project.base !== 'vanilla' || !VANILLA_DATA_RE.test(path)) return null
    await deps.vanilla.prepareData(project.authoringVersion)
    return deps.vanilla.resolveFile(project.authoringVersion, path)
  }

  async function packDataFiles(
    location: PackLocation
  ): Promise<Array<{ path: string; abs: string }>> {
    const files = await scanFiles(join(location.folder, 'data'), 'data/')
    return files.filter((f) => parseDataPath(f.path) !== null)
  }

  /** Id of the custom item generating `path` (M14), if any. */
  async function generatedBy(location: PackLocation, path: string): Promise<string | undefined> {
    const names = await fs.readdir(join(location.folder, ...ITEMS_DIR.split('/'))).catch(() => [])
    const files: Array<{ path: string; text: string }> = []
    for (const name of names) {
      const itemPath = `${ITEMS_DIR}/${name}`
      if (!ITEM_DEF_RE.test(itemPath)) continue
      const bytes = await readOptional(resolvePackFile(location.folder, itemPath))
      if (bytes) files.push({ path: itemPath, text: decoder.decode(bytes) })
    }
    return itemGenerating(path, parseItemFiles(files).items)?.id
  }

  async function ids(location: PackLocation, packPaths: readonly string[]): Promise<DataIds> {
    const version = location.project.authoringVersion
    // Ids come from the game, whatever the pack's base.
    await deps.vanilla.prepareData(version)
    const index = await deps.vanilla.getIndex(version)
    return collectDataIds([...Object.keys(index?.entries ?? {}), ...packPaths])
  }

  function entryOf(path: string, status: DataEntry['status']): DataEntry {
    const info = parseDataPath(path)!
    return {
      path,
      namespace: info.namespace,
      kind: info.kind,
      id: info.id,
      ...(info.registry ? { registry: info.registry } : {}),
      status
    }
  }

  async function statusOf(
    location: PackLocation,
    path: string,
    data: Uint8Array
  ): Promise<DataEntry['status']> {
    const vanilla = await readOptional(await vanillaFile(location, path))
    if (!vanilla) return 'added'
    return sameContent(path, vanilla, data) ? 'vanilla' : 'modified'
  }

  /** Text checks shared by save, create and saveMany; returns the bytes to write (null = remove the pack's copy). */
  async function prepareWrite(
    location: PackLocation,
    path: string,
    text: string
  ): Promise<{ abs: string; after: Uint8Array | null }> {
    const abs = dataFile(location, path)
    const bytes = encoder.encode(text)
    if (bytes.byteLength > MAX_DATA_FILE_BYTES) {
      throw new AppErrorException(DataErrorCode.tooLarge, { path, limit: MAX_DATA_FILE_BYTES })
    }
    await assertInsidePack(location.folder, abs, path)
    const vanilla = await readOptional(await vanillaFile(location, path))
    return { abs, after: vanilla && sameContent(path, vanilla, bytes) ? null : bytes }
  }

  async function write(
    location: PackLocation,
    path: string,
    after: Uint8Array | null,
    label: HistoryEntry['label']
  ): Promise<DataEntry> {
    try {
      await deps.history.apply(location.id, { source: 'editor', label, changes: [{ path, after }] })
      return entryOf(path, after ? await statusOf(location, path, after) : 'vanilla')
    } finally {
      deps.notifyChanged(location.id)
    }
  }

  return {
    async list(packId) {
      const location = await requireLocation(packId)
      const own = await packDataFiles(location)
      const vanillaBased = location.project.base === 'vanilla'
      const vanillaData = vanillaBased
        ? await deps.vanilla.prepareData(location.project.authoringVersion)
        : true
      const index =
        vanillaBased && vanillaData
          ? await deps.vanilla.getIndex(location.project.authoringVersion)
          : null
      const entries = new Map<string, DataEntry>()
      for (const path of Object.keys(index?.entries ?? {})) {
        if (VANILLA_DATA_RE.test(path)) entries.set(path, entryOf(path, 'vanilla'))
      }
      for (const file of own) {
        const vanilla = index?.entries[file.path]
        let status: DataEntry['status'] = 'added'
        if (vanilla) {
          const data = new Uint8Array(await fs.readFile(file.abs))
          status = vanilla.sha256 === sha256(data) ? 'vanilla' : 'modified'
          // Same JSON with other formatting is still a change on disk, but not for Minecraft.
          if (status === 'modified') status = await statusOf(location, file.path, data)
        }
        entries.set(file.path, entryOf(file.path, status))
      }
      return {
        entries: [...entries.values()].sort((a, b) => comparePaths(a.path, b.path)),
        vanillaData,
        ids: await ids(
          location,
          own.map((f) => f.path)
        )
      }
    },

    async ids(packId) {
      const location = await requireLocation(packId)
      return ids(
        location,
        (await packDataFiles(location)).map((f) => f.path)
      )
    },

    async read(packId, path) {
      const location = await requireLocation(packId)
      const own = await readOptional(dataFile(location, path))
      const vanilla = await readOptional(await vanillaFile(location, path))
      const text = own ?? vanilla
      const item = own ? await generatedBy(location, path) : undefined
      return {
        path,
        text: text ? decoder.decode(text) : null,
        origin: own ? 'pack' : vanilla ? 'vanilla' : 'none',
        vanillaText: vanilla ? decoder.decode(vanilla) : null,
        ...(item ? { generatedBy: item } : {})
      }
    },

    async vanillaText(packId, path) {
      const location = await requireLocation(packId)
      dataFile(location, path)
      if (!VANILLA_DATA_RE.test(path)) return null
      const version = location.project.authoringVersion
      await deps.vanilla.prepareData(version)
      const bytes = await readOptional(deps.vanilla.resolveFile(version, path))
      return bytes ? decoder.decode(bytes) : null
    },

    async packText(packId, path) {
      const location = await requireLocation(packId)
      const bytes = await readOptional(dataFile(location, path))
      return bytes ? decoder.decode(bytes) : null
    },

    async names(packId) {
      const version = (await requireLocation(packId)).project.authoringVersion
      let names = namesCache.get(version)
      if (!names) {
        names = (async () => {
          const file = deps.vanilla.resolveFile(version, 'assets/minecraft/lang/en_us.json')
          const bytes = await readOptional(file)
          return namesFromLang(bytes ? parseJson(bytes) : undefined)
        })()
        namesCache.set(version, names)
        // A version extracted later must not keep an empty map.
        names
          .then((n) => Object.keys(n).length === 0 && namesCache.delete(version))
          .catch(() => namesCache.delete(version))
      }
      return names
    },

    async save(packId, path, text) {
      const location = await requireLocation(packId)
      const { after } = await prepareWrite(location, path, text)
      return write(location, path, after, { key: 'saveData', params: { name: fileName(path) } })
    },

    async create(packId, path, text) {
      const location = await requireLocation(packId)
      const { abs, after } = await prepareWrite(location, path, text)
      if ((await readOptional(abs)) || (await vanillaFile(location, path))) {
        throw new AppErrorException(DataErrorCode.exists, { path })
      }
      return write(location, path, after ?? encoder.encode(text), {
        key: 'createData',
        params: { name: fileName(path) }
      })
    },

    async remove(packId, path) {
      const location = await requireLocation(packId)
      const abs = dataFile(location, path)
      if (!(await readOptional(abs))) throw new AppErrorException(DataErrorCode.notInPack, { path })
      await write(location, path, null, { key: 'deleteData', params: { name: fileName(path) } })
    },

    async saveMany(packId, files, change) {
      if (files.length === 0) return null
      const location = await requireLocation(packId)
      const changes: Array<{ path: string; after: Uint8Array | null }> = []
      for (const { path, text } of files) {
        changes.push({ path, after: (await prepareWrite(location, path, text)).after })
      }
      try {
        return await deps.history.apply(packId, { ...change, changes })
      } finally {
        deps.notifyChanged(packId)
      }
    }
  }
}
