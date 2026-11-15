import type { BlockElement, BlockPreview } from '@shared/model/preview'
import { blockstateModels, type BlockstateModelRef } from './blockstates'
import {
  FACE_NAMES,
  ModelResolveError,
  bakeElements,
  resolveModel,
  type ResolvedModel
} from './models'
import { NO_TINT, knownTint, tintFor } from './tints'

/** Parsed model and blockstate files by id ("minecraft:block/stone"); null = invalid JSON. */
export interface ModelFiles {
  models: Map<string, unknown>
  blockstates: Map<string, unknown>
}

/** A model whose faces all point to pack texture paths. */
export interface BakedModel {
  id: string
  elements: BlockElement[]
}

export interface BlockIndex {
  /** Models that resolved to at least one textured face (item models excluded). */
  models: Map<string, BakedModel>
  /** Texture pack path -> ids of the models whose faces use it, sorted. */
  byTexture: Map<string, string[]>
  /** Blockstate id ("minecraft:grass_block") -> referenced models in file order. */
  blockstates: Map<string, BlockstateModelRef[]>
  /** Models that failed to resolve (invalid JSON, missing parent, cycle), with the reason. */
  broken: Array<{ id: string; reason: string }>
}

/** Model id of the generated fallback cube (no model uses the texture). */
export const FALLBACK_MODEL_ID = 'blocksmith:builtin/cube'

/** Item models ("<ns>:item/...") describe inventory rendering, not blocks: they are not indexed. */
function isItemModel(id: string): boolean {
  return id.slice(id.indexOf(':') + 1).startsWith('item/')
}

/** Builds the reverse index texture path -> models. Never throws on bad content. */
export function buildBlockIndex(files: ModelFiles): BlockIndex {
  const memo = new Map<string, ResolvedModel | ModelResolveError>()
  const lookup = (id: string): unknown => files.models.get(id)
  const models = new Map<string, BakedModel>()
  const byTexture = new Map<string, Set<string>>()
  const broken: BlockIndex['broken'] = []

  for (const id of files.models.keys()) {
    if (isItemModel(id)) continue
    let resolved: ResolvedModel
    try {
      resolved = resolveModel(id, lookup, memo)
    } catch (err) {
      broken.push({ id, reason: err instanceof Error ? err.message : String(err) })
      continue
    }
    const elements = bakeElements(resolved)
    if (elements.length === 0) continue
    models.set(id, { id, elements })
    for (const element of elements) {
      for (const name of FACE_NAMES) {
        const texture = element.faces[name]?.texture
        if (!texture) continue
        let set = byTexture.get(texture)
        if (!set) byTexture.set(texture, (set = new Set()))
        set.add(id)
      }
    }
  }

  const blockstates = new Map<string, BlockstateModelRef[]>()
  for (const [id, json] of files.blockstates) {
    const refs = blockstateModels(json)
    if (refs.length > 0) blockstates.set(id, refs)
  }

  const sorted = new Map<string, string[]>()
  for (const [texture, set] of byTexture) sorted.set(texture, [...set].sort())
  return { models, byTexture: sorted, blockstates, broken }
}

export interface BlockModelChoice {
  modelId: string
  /** Name used for the tint table: the blockstate name, or the model's last path segment. */
  blockName: string
  rule: 'blockstate' | 'name' | 'fewestElements'
}

/** "assets/minecraft/textures/block/grass_block_top.png" -> { ns: "minecraft", name: "grass_block_top" } */
function textureNameOf(texturePath: string): { ns: string; name: string } {
  const ns = texturePath.split('/')[1] ?? 'minecraft'
  const file = texturePath.slice(texturePath.lastIndexOf('/') + 1)
  return { ns, name: file.endsWith('.png') ? file.slice(0, -4) : file }
}

/** "grass_block_top" -> ["grass_block_top", "grass_block", "grass"] */
export function namePrefixes(name: string): string[] {
  const parts = name.split('_')
  const out: string[] = []
  for (let n = parts.length; n > 0; n--) out.push(parts.slice(0, n).join('_'))
  return out
}

function lastSegment(id: string): string {
  return id.slice(Math.max(id.lastIndexOf(':'), id.lastIndexOf('/')) + 1)
}

/**
 * Picks the model shown for a block texture, among the models that use it:
 * 1. a model of the blockstate named like the texture or one of its "_" prefixes (grass_block_top -> grass_block),
 *    longest name first, preferring a variant without x/y rotation;
 * 2. the model "<ns>:block/<texture name>";
 * 3. the model with the fewest elements (ties: shortest id, then alphabetical).
 * Returns null when no model uses the texture.
 */
export function chooseBlockModel(index: BlockIndex, texturePath: string): BlockModelChoice | null {
  const candidates = index.byTexture.get(texturePath)
  if (!candidates || candidates.length === 0) return null
  const users = new Set(candidates)
  const { ns, name } = textureNameOf(texturePath)

  for (const prefix of namePrefixes(name)) {
    const refs = index.blockstates.get(`${ns}:${prefix}`)
    if (!refs) continue
    const using = refs.filter((r) => users.has(r.model))
    const pick = using.find((r) => !r.rotated) ?? using[0]
    if (pick) return { modelId: pick.model, blockName: prefix, rule: 'blockstate' }
  }

  const named = `${ns}:block/${name}`
  if (users.has(named)) return { modelId: named, blockName: name, rule: 'name' }

  let best: BakedModel | undefined
  for (const id of candidates) {
    const model = index.models.get(id)
    if (!model) continue
    if (
      !best ||
      model.elements.length < best.elements.length ||
      (model.elements.length === best.elements.length &&
        (id.length < best.id.length || (id.length === best.id.length && id < best.id)))
    ) {
      best = model
    }
  }
  return best ? { modelId: best.id, blockName: lastSegment(best.id), rule: 'fewestElements' } : null
}

/** Default colors for every tintindex used by `elements`. */
export function tintsFor(elements: BlockElement[], blockName: string): Record<number, string> {
  const tints: Record<number, string> = {}
  for (const element of elements) {
    for (const name of FACE_NAMES) {
      const tint = element.faces[name]?.tintindex
      if (tint !== undefined && !(tint in tints)) tints[tint] = tintFor(blockName)
    }
  }
  return tints
}

/**
 * Full cube with the texture on every face, for block textures no model uses. Textures of known tinted blocks
 * (water_still, oak_leaves...) get tintindex 0 with that block's color so grayscale textures look right.
 */
export function fallbackCube(texturePath: string): BlockPreview {
  const { name } = textureNameOf(texturePath)
  const tint = knownTint(name)
  const tinted = tint !== undefined && tint !== NO_TINT
  const faces: BlockElement['faces'] = {}
  for (const face of FACE_NAMES) {
    faces[face] = { texture: texturePath, uv: [0, 0, 16, 16], ...(tinted ? { tintindex: 0 } : {}) }
  }
  return {
    kind: 'block',
    modelId: FALLBACK_MODEL_ID,
    elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces }],
    tints: tinted ? { 0: tint } : {}
  }
}

/** Block preview of a texture from an index: the chosen model, or the fallback cube. */
export function blockPreviewFor(index: BlockIndex, texturePath: string): BlockPreview {
  const choice = chooseBlockModel(index, texturePath)
  const model = choice ? index.models.get(choice.modelId) : undefined
  if (!choice || !model) return fallbackCube(texturePath)
  const elements = structuredClone(model.elements)
  return {
    kind: 'block',
    modelId: model.id,
    elements,
    tints: tintsFor(elements, choice.blockName)
  }
}
