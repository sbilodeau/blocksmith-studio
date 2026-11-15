import type { EntityDefinition, PreviewModel } from '@shared/model/preview'
import { findEntityDefinition } from '@shared/preview/entities'
import { findEntityLayer } from '@shared/preview/entity-layers'
import type { VanillaStore } from '../contracts'
import { AppErrorException } from '../../ipc/registry'
import { resolvePackFile } from '../history/pack-files'
import { PackErrorCode, TextureErrorCode, type PackLocation, type PackService } from '../packs'
import { isValidResourcePath } from '../packs/paths'
import { TEXTURE_PNG } from '../packs/textures'
import {
  blockPreviewFor,
  buildBlockIndex,
  fallbackCube,
  type BlockIndex,
  type ModelFiles
} from './block-index'
import { previewCategory } from './category'
import {
  filesSignature,
  loadPackModelFiles,
  loadVanillaModelFiles,
  overlayModelFiles,
  scanPackModelFiles
} from './sources'

/** Block indexes kept in memory (one per distinct vanilla version + pack model files). */
const MAX_CACHED_INDEXES = 8

export interface PreviewServiceDeps {
  packs: Pick<PackService, 'locate'>
  vanilla: Pick<VanillaStore, 'getIndex' | 'resolveFile'> &
    Partial<Pick<VanillaStore, 'entityModels'>>
  /** Defaults to console.warn. */
  warn?: (message: string) => void
  /** Index build timings; defaults to console.info. */
  info?: (message: string) => void
  /** Defaults to the built-in entity definitions (src/shared/preview/entities.ts). */
  findEntity?: (packPath: string) => EntityDefinition | undefined
  /** Defaults to the texture -> jar layer table (src/shared/preview/entity-layers.ts). */
  findLayer?: (packPath: string) => string | undefined
}

export interface PreviewService {
  /** 3D preview model of a pack texture ('texture.preview'). */
  preview(packId: string, path: string): Promise<PreviewModel>
  /** Block index of a pack (built on first use, then cached until its model files change). */
  blockIndex(location: PackLocation): Promise<BlockIndex>
}

export function createPreviewService(deps: PreviewServiceDeps): PreviewService {
  const warn = deps.warn ?? ((message: string): void => console.warn(message))
  const info = deps.info ?? ((message: string): void => console.info(message))
  const findEntity = deps.findEntity ?? findEntityDefinition
  const findLayer = deps.findLayer ?? findEntityLayer

  /** The model read from the pack's Minecraft jar for this texture, if the table names a layer and it exists. */
  async function jarEntity(versionId: string, path: string): Promise<EntityDefinition | undefined> {
    const layer = findLayer(path)
    if (!layer || !deps.vanilla.entityModels) return undefined
    try {
      const models = await deps.vanilla.entityModels(versionId)
      const found = models?.layers[layer]
      if (!found) return undefined
      return {
        id: layer.replace(/[^a-z0-9_]+/g, '_'),
        textureSize: found.textureSize,
        textures: [path],
        animation: found.animation,
        parts: found.parts
      }
    } catch (err) {
      warn(`[preview] entity models of ${versionId}: ${String(err)}`)
      return undefined
    }
  }
  /** Parsed vanilla model files per version, reloaded when the version is re-extracted. */
  const vanillaFiles = new Map<string, { stamp: string; files: Promise<ModelFiles> }>()
  /** Block indexes by vanilla version + pack model file signature, least recently used first. */
  const indexes = new Map<string, Promise<BlockIndex>>()

  function vanillaModelFiles(
    versionId: string,
    stamp: string,
    load: () => Promise<ModelFiles>
  ): Promise<ModelFiles> {
    const hit = vanillaFiles.get(versionId)
    if (hit && hit.stamp === stamp) return hit.files
    const files = load()
    vanillaFiles.set(versionId, { stamp, files })
    files.catch(() => vanillaFiles.delete(versionId))
    return files
  }

  async function blockIndex(location: PackLocation): Promise<BlockIndex> {
    const { project } = location
    const vanillaIndex =
      project.base === 'vanilla' ? await deps.vanilla.getIndex(project.authoringVersion) : null
    const packFiles = await scanPackModelFiles(location.folder)
    const vanillaKey = vanillaIndex ? `${vanillaIndex.versionId}@${vanillaIndex.createdAt}` : '-'
    const packKey = packFiles.length > 0 ? `${location.folder}\n${filesSignature(packFiles)}` : ''
    const key = `${vanillaKey}\n${packKey}`

    const cached = indexes.get(key)
    if (cached) {
      indexes.delete(key)
      indexes.set(key, cached)
      return cached
    }

    const build = (async (): Promise<BlockIndex> => {
      const started = performance.now()
      const base: ModelFiles = vanillaIndex
        ? await vanillaModelFiles(vanillaIndex.versionId, vanillaIndex.createdAt, () =>
            loadVanillaModelFiles(deps.vanilla, vanillaIndex)
          )
        : { models: new Map(), blockstates: new Map() }
      const files =
        packFiles.length > 0 ? overlayModelFiles(base, await loadPackModelFiles(packFiles)) : base
      const index = buildBlockIndex(files)
      if (index.broken.length > 0) {
        const sample = index.broken
          .slice(0, 5)
          .map((b) => `${b.id} (${b.reason})`)
          .join(', ')
        warn(`[preview] ${index.broken.length} block model(s) could not be resolved: ${sample}`)
      }
      const ms = Math.round(performance.now() - started)
      info(
        `[preview] block index for ${location.id}: ${index.models.size} models, ` +
          `${index.byTexture.size} textures in ${ms} ms`
      )
      return index
    })()
    indexes.set(key, build)
    build.catch(() => indexes.delete(key))
    while (indexes.size > MAX_CACHED_INDEXES) {
      const oldest = indexes.keys().next().value
      if (oldest === undefined) break
      indexes.delete(oldest)
    }
    return build
  }

  return {
    blockIndex,

    async preview(packId, path) {
      const location = await deps.packs.locate(packId)
      if (!location) throw new AppErrorException(PackErrorCode.notFound, { packId })
      if (
        !TEXTURE_PNG.test(path) ||
        !isValidResourcePath(path) ||
        !resolvePackFile(location.folder, path)
      ) {
        throw new AppErrorException(TextureErrorCode.invalidPath, { path })
      }
      switch (previewCategory(path)) {
        case 'entity': {
          // Jar models first (exact, every entity of 26.1+), then the built-in definitions, then flat.
          const fromJar = await jarEntity(location.project.authoringVersion, path)
          if (fromJar) return { kind: 'entity', definition: fromJar, source: 'jar' }
          const definition = findEntity(path)
          return definition ? { kind: 'entity', definition, source: 'builtin' } : { kind: 'flat' }
        }
        case 'item':
          return { kind: 'item' }
        case 'flat':
          return { kind: 'flat' }
        case 'block':
          try {
            return blockPreviewFor(await blockIndex(location), path)
          } catch (err) {
            warn(`[preview] block index failed for ${packId}: ${String(err)}`)
            return fallbackCube(path)
          }
      }
    }
  }
}
