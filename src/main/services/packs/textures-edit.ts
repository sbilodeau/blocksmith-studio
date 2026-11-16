import { decode } from 'fast-png'
import type { HistoryEntry, TextureData } from '@shared/model/history'
import type { TextureEntry } from '@shared/model/pack'
import type { VanillaStore } from '../contracts'
import { AppErrorException } from '../../ipc/registry'
import type { HistoryService } from '../history'
import { assertInsidePack, readOptional, resolvePackFile } from '../history/pack-files'
import { isValidResourcePath } from './paths'
import { readPngHeader } from './png'
import type { PackLocation } from './project'
import type { PackService } from './service'
import { TEXTURE_PNG } from './textures'

/** Largest texture side accepted by texture.save. */
export const MAX_TEXTURE_SIZE = 4096

/** Error codes thrown by the texture edit service (i18n: `errors.<code>`). */
export const TextureErrorCode = {
  /** Not assets/<ns>/textures/...png, or unsafe (params: path). */
  invalidPath: 'texture.invalidPath',
  /** Bad signature / IHDR, undecodable, or a side outside 1..4096. */
  invalidPng: 'texture.invalidPng',
  /** texture.revert on a texture the pack does not contain (params: path). */
  notInPack: 'texture.notInPack',
  /** texture.revert on a texture with no vanilla counterpart (empty pack or added texture; params: path). */
  noVanilla: 'texture.noVanilla'
} as const

export interface TextureEditServiceDeps {
  packs: Pick<PackService, 'locate' | 'textures'>
  vanilla: Pick<VanillaStore, 'resolveFile'>
  history: Pick<HistoryService, 'apply'>
  /** Main forwards this as the 'packs.changed' event. */
  notifyChanged: (packId: string) => void
}

export interface TextureEditService {
  read(packId: string, path: string): Promise<TextureData>
  save(packId: string, path: string, png: Uint8Array): Promise<TextureEntry>
  revert(packId: string, path: string): Promise<TextureEntry>
  /**
   * Writes several textures as ONE history entry (bulk operations, AI proposals over a selection). Textures that
   * end up identical to vanilla are removed from the pack instead. Returns the entry (null when `items` is empty).
   */
  saveMany(
    packId: string,
    items: ReadonlyArray<{ path: string; png: Uint8Array }>,
    change: { source: HistoryEntry['source']; label: HistoryEntry['label'] }
  ): Promise<HistoryEntry | null>
}

/** True when `png` has a valid signature and IHDR, sides in 1..MAX_TEXTURE_SIZE, and decodes. */
export function isValidTexturePng(png: Uint8Array): boolean {
  const header = readPngHeader(png)
  if (!header || header.width > MAX_TEXTURE_SIZE || header.height > MAX_TEXTURE_SIZE) return false
  try {
    decode(png)
    return true
  } catch {
    return false
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false
  return true
}

/** "assets/minecraft/textures/block/stone.png" -> "stone" */
function textureName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1, -'.png'.length)
}

export function createTextureEditService(deps: TextureEditServiceDeps): TextureEditService {
  async function requireLocation(packId: string): Promise<PackLocation> {
    const location = await deps.packs.locate(packId)
    if (!location) throw new AppErrorException('packs.notFound', { packId })
    return location
  }

  /** Validates a texture path again (main never trusts the renderer) and returns the pack file path. */
  function texturePath(location: PackLocation, path: string): string {
    const abs =
      TEXTURE_PNG.test(path) && isValidResourcePath(path)
        ? resolvePackFile(location.folder, path)
        : null
    if (!abs) throw new AppErrorException(TextureErrorCode.invalidPath, { path })
    return abs
  }

  function vanillaFile(location: PackLocation, path: string): string | null {
    const { project } = location
    return project.base === 'vanilla'
      ? deps.vanilla.resolveFile(project.authoringVersion, path)
      : null
  }

  /** Texture entry after a write; the renderer is notified even if the index cannot be rebuilt. */
  async function freshEntry(location: PackLocation, path: string): Promise<TextureEntry> {
    try {
      const entry = (await deps.packs.textures(location.id)).find((e) => e.path === path)
      if (!entry) throw new Error(`texture ${path} missing from the index after a write`)
      return entry
    } finally {
      deps.notifyChanged(location.id)
    }
  }

  return {
    async read(packId, path) {
      const location = await requireLocation(packId)
      const abs = texturePath(location, path)
      const packPng = await readOptional(abs)
      const vanillaPng = await readOptional(vanillaFile(location, path))
      const png = packPng ?? vanillaPng
      const mcmeta =
        (await readOptional(`${abs}.mcmeta`)) ??
        (await readOptional(vanillaFile(location, `${path}.mcmeta`)))
      return {
        path,
        png,
        origin: packPng ? 'pack' : vanillaPng ? 'vanilla' : 'none',
        vanillaPng,
        mcmeta: mcmeta ? new TextDecoder().decode(mcmeta) : null
      }
    },

    async save(packId, path, png) {
      const location = await requireLocation(packId)
      const abs = texturePath(location, path)
      if (!isValidTexturePng(png)) throw new AppErrorException(TextureErrorCode.invalidPng)
      await assertInsidePack(location.folder, abs, path)
      const vanillaPng = await readOptional(vanillaFile(location, path))
      // Identical to vanilla: the pack keeps only changed files, so the copy is removed instead.
      const after = vanillaPng && sameBytes(vanillaPng, png) ? null : png
      await deps.history.apply(packId, {
        source: 'editor',
        label: { key: 'save', params: { name: textureName(path) } },
        changes: [{ path, after }]
      })
      return freshEntry(location, path)
    },

    async saveMany(packId, items, change) {
      if (items.length === 0) return null
      const location = await requireLocation(packId)
      const changes: Array<{ path: string; after: Uint8Array | null }> = []
      for (const { path, png } of items) {
        const abs = texturePath(location, path)
        if (!isValidTexturePng(png)) throw new AppErrorException(TextureErrorCode.invalidPng)
        await assertInsidePack(location.folder, abs, path)
        const vanillaPng = await readOptional(vanillaFile(location, path))
        changes.push({ path, after: vanillaPng && sameBytes(vanillaPng, png) ? null : png })
      }
      try {
        return await deps.history.apply(packId, { ...change, changes })
      } finally {
        deps.notifyChanged(packId)
      }
    },

    async revert(packId, path) {
      const location = await requireLocation(packId)
      const abs = texturePath(location, path)
      if (!(await readOptional(abs))) {
        throw new AppErrorException(TextureErrorCode.notInPack, { path })
      }
      if (!vanillaFile(location, path)) {
        throw new AppErrorException(TextureErrorCode.noVanilla, { path })
      }
      await deps.history.apply(packId, {
        source: 'revert',
        label: { key: 'revert', params: { name: textureName(path) } },
        changes: [{ path, after: null }]
      })
      return freshEntry(location, path)
    }
  }
}
