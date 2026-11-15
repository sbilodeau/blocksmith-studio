import type { BlockElement, BlockFace, FaceName, Vec3 } from '@shared/model/preview'

/**
 * Minecraft block model resolution (parent chains, texture variables, elements, default UVs). Pure functions over
 * already-parsed JSON so they can be unit tested without files. Format reference:
 * https://minecraft.wiki/w/Tutorial:Models#Block_models
 */

export const FACE_NAMES: readonly FaceName[] = ['north', 'south', 'east', 'west', 'up', 'down']

/** Parents implemented in Java code: they carry no elements, so the chain stops there. */
const BUILTIN_PREFIX = 'builtin/'

/** Longest parent chain followed before giving up (vanilla chains are 3 to 5 deep). */
export const MAX_PARENT_DEPTH = 32

/** A model as read from disk; `undefined` when the file is missing, `null` when its JSON is invalid. */
export type RawModelLookup = (modelId: string) => unknown

/** A model with its parent chain applied. Faces still reference texture variables. */
export interface ResolvedModel {
  id: string
  /** Texture variables, child values winning over parents (values are "#ref" or texture ids). */
  textures: Record<string, string>
  /** Elements of the nearest model in the chain that defines them (empty for builtin parents). */
  elements: BlockElement[]
}

export class ModelResolveError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

/** "block/stone" or "minecraft:block/stone" -> "minecraft:block/stone". */
export function normalizeResourceId(id: string): string {
  return id.includes(':') ? id : `minecraft:${id}`
}

/** "minecraft:block/stone" -> "assets/minecraft/textures/block/stone.png"; null when not a valid resource id. */
export function textureIdToPath(id: string): string | null {
  const full = normalizeResourceId(id)
  const colon = full.indexOf(':')
  const ns = full.slice(0, colon)
  const path = full.slice(colon + 1)
  if (!/^[a-z0-9_.-]+$/.test(ns) || !/^[a-z0-9_.\-/]+$/.test(path)) return null
  if (path.split('/').some((s) => s === '' || s === '.' || s === '..')) return null
  return `assets/${ns}/textures/${path}.png`
}

/** Rounds away float noise such as 16 - 15.2 = 0.8000000000000007. */
function round(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

/** Minecraft's default face UV when a face has no "uv": the element's projection on that face. */
export function defaultFaceUv(
  face: FaceName,
  from: Vec3,
  to: Vec3
): [number, number, number, number] {
  const [x1, y1, z1] = from
  const [x2, y2, z2] = to
  return projectFace(face, x1, y1, z1, x2, y2, z2).map(round) as [number, number, number, number]
}

function projectFace(
  face: FaceName,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number
): number[] {
  switch (face) {
    case 'down':
      return [x1, 16 - z2, x2, 16 - z1]
    case 'up':
      return [x1, z1, x2, z2]
    case 'north':
      return [16 - x2, 16 - y2, 16 - x1, 16 - y1]
    case 'south':
      return [x1, 16 - y2, x2, 16 - y1]
    case 'west':
      return [z1, 16 - y2, z2, 16 - y1]
    case 'east':
      return [16 - z2, 16 - y2, 16 - z1, 16 - y1]
  }
}

/** Texture variable value: "#ref", a texture id, or (1.21.6+) { sprite: "<id>", ... }. */
function textureValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value['sprite'] === 'string') return value['sprite']
  return undefined
}

function parseTextures(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isRecord(value)) return out
  for (const [key, raw] of Object.entries(value)) {
    const v = textureValue(raw)
    if (v !== undefined) out[key] = v
  }
  return out
}

/**
 * Parses one face. `texture` is kept as the variable name (without "#"); a value without "#" is treated as a
 * variable too, like Minecraft does. Faces without a texture are dropped.
 */
function parseFace(face: FaceName, value: unknown, from: Vec3, to: Vec3): BlockFace | null {
  if (!isRecord(value) || typeof value['texture'] !== 'string') return null
  const texture = value['texture'].startsWith('#') ? value['texture'].slice(1) : value['texture']
  const uvRaw = value['uv']
  const uv =
    Array.isArray(uvRaw) &&
    uvRaw.length === 4 &&
    uvRaw.every((n) => typeof n === 'number' && Number.isFinite(n))
      ? (uvRaw as [number, number, number, number])
      : defaultFaceUv(face, from, to)
  const out: BlockFace = { texture, uv: [uv[0], uv[1], uv[2], uv[3]] }
  const rotation = value['rotation']
  if (rotation === 90 || rotation === 180 || rotation === 270) out.rotation = rotation
  const tint = value['tintindex']
  if (typeof tint === 'number' && Number.isInteger(tint) && tint >= 0) out.tintindex = tint
  return out
}

/** Parses an element; malformed elements (bad from/to) return null and are skipped. */
export function parseElement(value: unknown): BlockElement | null {
  if (!isRecord(value) || !isVec3(value['from']) || !isVec3(value['to'])) return null
  const from: Vec3 = [...value['from']]
  const to: Vec3 = [...value['to']]
  const element: BlockElement = { from, to, faces: {} }
  const rot = value['rotation']
  if (isRecord(rot) && typeof rot['angle'] === 'number' && Number.isFinite(rot['angle'])) {
    const axis = rot['axis']
    if (axis === 'x' || axis === 'y' || axis === 'z') {
      element.rotation = {
        origin: isVec3(rot['origin']) ? [...rot['origin']] : [8, 8, 8],
        axis,
        angle: rot['angle']
      }
      if (rot['rescale'] === true) element.rotation.rescale = true
    }
  }
  if (value['shade'] === false) element.shade = false
  const faces = value['faces']
  if (isRecord(faces)) {
    for (const name of FACE_NAMES) {
      const face = parseFace(name, faces[name], from, to)
      if (face) element.faces[name] = face
    }
  }
  return element
}

/**
 * Resolves the parent chain of `modelId`: textures merged with the child winning, elements from the nearest model
 * that has them. Throws ModelResolveError for missing or invalid models, parent cycles and over-deep chains.
 * Results are memoized in `memo` (shared across calls to resolve thousands of models quickly).
 */
export function resolveModel(
  modelId: string,
  lookup: RawModelLookup,
  memo: Map<string, ResolvedModel | ModelResolveError> = new Map()
): ResolvedModel {
  const visiting = new Set<string>()

  function resolve(id: string, depth: number): ResolvedModel {
    const cached = memo.get(id)
    if (cached instanceof ModelResolveError) throw cached
    if (cached) return cached
    if (visiting.has(id)) throw new ModelResolveError(`parent cycle at ${id}`)
    if (depth > MAX_PARENT_DEPTH) throw new ModelResolveError(`parent chain too deep at ${id}`)
    visiting.add(id)
    try {
      const raw = lookup(id)
      if (raw === undefined) throw new ModelResolveError(`model ${id} not found`)
      if (!isRecord(raw)) throw new ModelResolveError(`model ${id} is not valid JSON`)
      let parent: ResolvedModel | null = null
      if (typeof raw['parent'] === 'string' && raw['parent'] !== '') {
        const parentId = normalizeResourceId(raw['parent'])
        const parentPath = parentId.slice(parentId.indexOf(':') + 1)
        if (!parentPath.startsWith(BUILTIN_PREFIX)) parent = resolve(parentId, depth + 1)
      }
      const ownElements = Array.isArray(raw['elements'])
        ? raw['elements'].map(parseElement).filter((e): e is BlockElement => e !== null)
        : null
      const model: ResolvedModel = {
        id,
        textures: { ...parent?.textures, ...parseTextures(raw['textures']) },
        elements: ownElements ?? parent?.elements ?? []
      }
      memo.set(id, model)
      return model
    } catch (err) {
      const error =
        err instanceof ModelResolveError
          ? err
          : new ModelResolveError(`model ${id}: ${String(err)}`)
      memo.set(id, error)
      throw error
    } finally {
      visiting.delete(id)
    }
  }

  return resolve(normalizeResourceId(modelId), 0)
}

/**
 * Resolves a texture variable (without "#") to a texture id, following "#ref" indirections. Returns null when the
 * variable is undefined or the references form a cycle (Minecraft shows its missing texture then).
 */
export function resolveTextureVariable(
  name: string,
  textures: Record<string, string>
): string | null {
  const seen = new Set<string>()
  let current = name
  for (;;) {
    if (seen.has(current)) return null
    seen.add(current)
    const value = textures[current]
    if (value === undefined) return null
    if (!value.startsWith('#')) return value
    current = value.slice(1)
  }
}

/**
 * Elements ready for the renderer: every face texture resolved to a pack path. Faces whose texture cannot be
 * resolved are dropped, then elements left without faces.
 */
export function bakeElements(model: ResolvedModel): BlockElement[] {
  const out: BlockElement[] = []
  for (const element of model.elements) {
    const faces: BlockElement['faces'] = {}
    let count = 0
    for (const name of FACE_NAMES) {
      const face = element.faces[name]
      if (!face) continue
      const id = resolveTextureVariable(face.texture, model.textures)
      const path = id ? textureIdToPath(id) : null
      if (!path) continue
      faces[name] = { ...face, texture: path, uv: [...face.uv] }
      count++
    }
    if (count > 0) out.push({ ...element, faces })
  }
  return out
}
