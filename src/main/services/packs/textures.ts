import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { packAssetUrl } from '@shared/assets'
import { splitTexturePath, type CategoryEngine } from '@shared/categories'
import type { CategorySummary, TextureEntry, TextureStatus } from '@shared/model/pack'
import type { VanillaIndex, VanillaIndexEntry } from '@shared/model/vanilla'
import type { VanillaStore } from '../contracts'
import { AppErrorException } from '../../ipc/registry'
import { FileInfoCache, mapLimit } from './files'
import { readAnimation } from './mcmeta'
import { comparePaths, scanFiles, type ScannedFile } from './paths'
import type { PackLocation } from './project'

export const TEXTURE_PNG = /^assets\/[^/]+\/textures\/.+\.png$/
const TEXTURE_MCMETA = /^assets\/[^/]+\/textures\/.+\.png\.mcmeta$/

/**
 * Status of a texture as seen by a pack:
 * - not in the pack, or byte-identical to vanilla -> 'vanilla'
 * - in the pack with no vanilla counterpart -> 'added'
 * - in the pack and different from vanilla -> 'modified'
 */
export function computeStatus(
  packSha: string | undefined,
  vanillaSha: string | undefined
): TextureStatus {
  if (packSha === undefined) return 'vanilla'
  if (vanillaSha === undefined) return 'added'
  return packSha === vanillaSha ? 'vanilla' : 'modified'
}

/** Short cache-busting token for asset URLs. */
function urlVersion(sha: string): string {
  return sha.slice(0, 12)
}

/** Lists texture files (.png and .png.mcmeta) of a pack folder: assets/<ns>/textures/** for every namespace. */
export async function scanPackTextures(folder: string): Promise<ScannedFile[]> {
  let namespaces: string[]
  try {
    const entries = await fs.readdir(join(folder, 'assets'), { withFileTypes: true })
    namespaces = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
  } catch {
    return []
  }
  const lists = await Promise.all(
    namespaces.map((ns) =>
      scanFiles(join(folder, 'assets', ns, 'textures'), `assets/${ns}/textures/`)
    )
  )
  return lists
    .flat()
    .filter((f) => TEXTURE_PNG.test(f.path) || TEXTURE_MCMETA.test(f.path))
    .sort((a, b) => comparePaths(a.path, b.path))
}

interface CachedIndex {
  signature: string
  entries: TextureEntry[]
}

/**
 * Builds the texture list of a pack: vanilla textures of its authoring version (vanilla base only) merged with
 * the pack's own textures. Results are cached per pack and reused while no texture file changed (size/mtime)
 * and the vanilla index is the same.
 */
export class TextureIndexer {
  private readonly cache = new Map<string, CachedIndex>()
  private readonly vanillaTextures = new WeakMap<VanillaIndex, VanillaIndexEntry[]>()
  private readonly pending = new Map<string, Promise<TextureEntry[]>>()
  /** Bumped by `forget`, so a scan that started before it does not cache its (possibly stale) result. */
  private epoch = 0

  constructor(
    private readonly vanilla: VanillaStore,
    private readonly engine: CategoryEngine,
    private readonly files: FileInfoCache
  ) {}

  /** Last computed list for a pack, if any (no I/O). */
  cached(packId: string): TextureEntry[] | undefined {
    return this.cache.get(packId)?.entries
  }

  forget(packId?: string): void {
    // A scan already running may have read files before the change: later calls start a new one.
    this.epoch++
    if (packId === undefined) {
      this.cache.clear()
      this.pending.clear()
    } else {
      for (const key of [packId, `${packId}:catalog`]) {
        this.cache.delete(key)
        this.pending.delete(key)
      }
    }
  }

  /**
   * Vanilla index of the pack's authoring version (vanilla base, or any base with `catalog`); throws
   * packs.vanillaNotReady when missing.
   */
  async vanillaIndexFor(location: PackLocation, catalog = false): Promise<VanillaIndex | null> {
    const { project } = location
    if (project.base !== 'vanilla' && !catalog) return null
    const index = await this.vanilla.getIndex(project.authoringVersion)
    if (!index) {
      throw new AppErrorException('packs.vanillaNotReady', { version: project.authoringVersion })
    }
    return index
  }

  /**
   * The pack's textures. With `catalog`, vanilla textures are included whatever the base (an empty pack's catalog is
   * every vanilla texture plus its own files): what the creation agent can change.
   */
  async textures(
    location: PackLocation,
    options: { catalog?: boolean } = {}
  ): Promise<TextureEntry[]> {
    // Concurrent calls for the same list (a pack tab asks for pack.get, pack.textures and pack.categories at
    // once) share one scan instead of each reading the pack.
    const key = options.catalog ? `${location.id}:catalog` : location.id
    const running = this.pending.get(key)
    if (running) return running
    const promise = this.load(location, key, options.catalog === true).finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key)
    })
    this.pending.set(key, promise)
    return promise
  }

  private async load(
    location: PackLocation,
    key: string,
    catalog: boolean
  ): Promise<TextureEntry[]> {
    const epoch = this.epoch
    const index = await this.vanillaIndexFor(location, catalog)
    const files = await scanPackTextures(location.folder)
    const signature =
      `${index ? `${index.versionId}@${index.createdAt}` : '-'}\n` +
      files.map((f) => `${f.path}\0${f.size}\0${f.mtimeMs}`).join('\n')
    const hit = this.cache.get(key)
    if (hit && hit.signature === signature) return hit.entries

    const entries = await this.build(location, index, files)
    if (epoch === this.epoch) this.cache.set(key, { signature, entries })
    return entries
  }

  private vanillaTextureEntries(index: VanillaIndex): VanillaIndexEntry[] {
    let list = this.vanillaTextures.get(index)
    if (!list) {
      list = Object.values(index.entries).filter((e) => TEXTURE_PNG.test(e.path))
      this.vanillaTextures.set(index, list)
    }
    return list
  }

  private entry(
    packId: string,
    path: string,
    fields: Pick<TextureEntry, 'width' | 'height' | 'animated' | 'frameCount' | 'status'>,
    sha: string
  ): TextureEntry | null {
    const split = splitTexturePath(path)
    if (!split) return null
    const entry: TextureEntry = {
      path,
      ...split,
      width: fields.width,
      height: fields.height,
      animated: fields.animated,
      status: fields.status,
      categories: this.engine.categorize(path),
      url: packAssetUrl(packId, path, urlVersion(sha))
    }
    if (fields.frameCount !== undefined) entry.frameCount = fields.frameCount
    return entry
  }

  private async build(
    location: PackLocation,
    index: VanillaIndex | null,
    files: ScannedFile[]
  ): Promise<TextureEntry[]> {
    const packId = location.id
    const byPath = new Map<string, TextureEntry>()

    if (index) {
      for (const v of this.vanillaTextureEntries(index)) {
        const e = this.entry(
          packId,
          v.path,
          {
            width: v.width ?? 0,
            height: v.height ?? 0,
            animated: v.animated ?? false,
            frameCount: v.animated ? v.frameCount : undefined,
            status: 'vanilla'
          },
          v.sha256
        )
        if (e) byPath.set(v.path, e)
      }
    }

    const pngs = files.filter((f) => f.path.endsWith('.png'))
    const metas = new Map(files.filter((f) => f.path.endsWith('.mcmeta')).map((f) => [f.path, f]))
    // Only a file the same size as its vanilla counterpart needs a full read and hash to get its status; any
    // other one is 'added' or 'modified' from its header alone (huge high-resolution packs open much faster).
    const infos = await mapLimit(pngs, 32, async (f) => {
      const v = index?.entries[f.path]
      if (v && v.size === f.size) {
        const info = await this.files.get(f)
        return { ...info, version: info.sha256, status: computeStatus(info.sha256, v.sha256) }
      }
      const header = await this.files.pngHeader(f)
      return { ...header, status: v ? 'modified' : ('added' as TextureStatus) }
    })

    pngs.forEach((file, i) => {
      const info = infos[i]
      const v = index?.entries[file.path]
      const width = info.width ?? 0
      const height = info.height ?? 0
      const animated = v?.animated ?? false
      // Animated in vanilla but no pack .mcmeta: assume vertical strip of square frames.
      let frameCount = animated && width > 0 ? Math.max(1, Math.floor(height / width)) : undefined
      if (animated && v && info.status === 'vanilla') frameCount = v.frameCount ?? frameCount
      const e = this.entry(
        packId,
        file.path,
        { width, height, animated, frameCount, status: info.status },
        info.version
      )
      if (e) byPath.set(file.path, e)
    })

    // A pack .png.mcmeta overrides the animation of its texture (pack or vanilla image).
    await mapLimit([...metas.values()], 32, async (meta) => {
      const target = byPath.get(meta.path.slice(0, -'.mcmeta'.length))
      if (!target) return
      const anim = readAnimation((await this.files.get(meta)).json, target.width, target.height)
      target.animated = anim !== null
      if (anim) target.frameCount = anim.frameCount
      else delete target.frameCount
    })

    return [...byPath.values()].sort((a, b) => comparePaths(a.path, b.path))
  }
}

/** Per-category counts in the engine's display order; categories without textures are omitted. */
export function summarizeCategories(
  entries: readonly TextureEntry[],
  engine: CategoryEngine
): CategorySummary[] {
  const groups = new Map<string, TextureEntry[]>()
  for (const entry of entries) {
    for (const id of entry.categories) {
      let list = groups.get(id)
      if (!list) groups.set(id, (list = []))
      list.push(entry)
    }
  }
  const summaries: CategorySummary[] = []
  for (const rule of engine.rules) {
    const list = groups.get(rule.id)
    if (!list || list.length === 0) continue
    const icon = list.find((e) => e.path === rule.icon) ?? list[0]
    summaries.push({
      id: rule.id,
      i18nKey: rule.i18nKey,
      count: list.length,
      changedCount: list.filter((e) => e.status !== 'vanilla').length,
      iconUrl: icon.url
    })
  }
  return summaries
}
