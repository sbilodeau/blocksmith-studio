/**
 * Reads every entity model layer from a Minecraft client jar (26.1+, not obfuscated) and converts it to the 3D
 * preview's EntityDefinition format (PLAN M3b). Runs `ModelLayers.<clinit>` and `LayerDefinitions.createRoots()`
 * in the symbolic interpreter, collects each (layer -> LayerDefinition) as it is registered, then walks the
 * resulting PartDefinition trees. Layers that depend on anything the interpreter cannot know are skipped.
 */
import { strFromU8, unzipSync } from 'fflate'
import type { EntityBox, EntityPart } from '@shared/model/preview'
import { ClassFile, parseClassFile } from './classfile'
import {
  BudgetExceeded,
  Interpreter,
  isModelCodeClass,
  JEnum,
  JList,
  JMap,
  JObject,
  JSet,
  type ClassSource,
  type JValue
} from './interpreter'

export const ENTITY_MODELS_FILE = 'entity-models.json'
export const ENTITY_MODELS_SCHEMA_VERSION = 1

export interface JarModelLayer {
  textureSize: [number, number]
  animation: 'biped' | 'quadruped' | 'none'
  parts: EntityPart[]
}

export interface JarEntityModels {
  schemaVersion: typeof ENTITY_MODELS_SCHEMA_VERSION
  versionId: string
  generatedAt: string
  /** Layer id (`axolotl_baby#main`) -> geometry. */
  layers: Record<string, JarModelLayer>
  /** Layers registered with a value the interpreter could not compute. */
  skipped: string[]
  /** Interpreter diagnostics: instruction count and abort count. */
  stats: { steps: number; aborts: number }
}

const LAYER_DEFINITIONS = 'net/minecraft/client/model/geom/LayerDefinitions'
const MODEL_LAYERS = 'net/minecraft/client/model/geom/ModelLayers'
const LAYER_DEFINITION = 'net/minecraft/client/model/geom/builders/LayerDefinition'
const MODEL_LAYER_LOCATION = 'net/minecraft/client/model/geom/ModelLayerLocation'

/** Jar entries the interpreter may read (see isModelCodeClass). */
export function isModelClassEntry(name: string): boolean {
  return name.endsWith('.class') && isModelCodeClass(name.slice(0, -'.class'.length))
}

export function classSourceFromEntries(entries: Record<string, Uint8Array>): ClassSource {
  const cache = new Map<string, ClassFile | null>()
  return {
    load(name) {
      if (cache.has(name)) return cache.get(name) ?? undefined
      const bytes = entries[`${name}.class`]
      let cls: ClassFile | null = null
      if (bytes) {
        try {
          cls = parseClassFile(bytes)
        } catch {
          cls = null
        }
      }
      cache.set(name, cls)
      return cls ?? undefined
    }
  }
}

/** Reads the model classes of a jar (bytes of the whole jar). */
export function modelClassEntries(jar: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(jar, { filter: (f) => isModelClassEntry(f.name) && f.originalSize < 4_000_000 })
}

/** True when the jar's model code is readable (26.1+ ships it unobfuscated). */
export function hasReadableModels(entries: Record<string, Uint8Array>): boolean {
  return `${LAYER_DEFINITIONS}.class` in entries && `${MODEL_LAYERS}.class` in entries
}

// ---------- conversion ----------
class Unknown extends Error {}

function num(v: JValue | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Unknown('unknown number')
  return v
}

function obj(v: JValue | undefined, cls?: string): JObject {
  if (!(v instanceof JObject) || (cls && v.cls !== cls))
    throw new Unknown(`expected ${cls ?? 'object'}`)
  return v
}

/** 4 decimals, and never -0 (flipping y/z produces negative zeros). */
const round = (n: number): number => Math.round(n * 10000) / 10000 || 0
const deg = (rad: number): number => round((rad * 180) / Math.PI)

/** Mojang Direction -> box UV face of src/shared/preview/box-uv.ts (WEST is the entity's right side). */
const FACE_OF_DIRECTION: Record<string, NonNullable<EntityBox['faces']>[number]> = {
  DOWN: 'bottom',
  UP: 'top',
  WEST: 'right',
  NORTH: 'front',
  EAST: 'left',
  SOUTH: 'back'
}

const ROLE_OF_PART: Record<string, NonNullable<EntityPart['role']>> = {
  head: 'head',
  body: 'body',
  right_arm: 'rightArm',
  left_arm: 'leftArm',
  right_leg: 'rightLeg',
  left_leg: 'leftLeg',
  right_front_leg: 'frontRightLeg',
  left_front_leg: 'frontLeftLeg',
  right_hind_leg: 'backRightLeg',
  left_hind_leg: 'backLeftLeg',
  tail: 'tail'
}

function convertCube(cube: JObject, px: number, py: number, pz: number): EntityBox {
  const origin = obj(cube.get('origin'))
  const dims = obj(cube.get('dimensions'))
  const grow = obj(cube.get('grow'))
  const uv = obj(cube.get('texCoord'))
  const ox = num(origin.get('x'))
  const oy = num(origin.get('y'))
  const oz = num(origin.get('z'))
  const w = num(dims.get('x'))
  const h = num(dims.get('y'))
  const d = num(dims.get('z'))
  const box: EntityBox = {
    origin: [round(px + ox), round(24 - (py + oy + h)), round(-(pz + oz + d))],
    size: [round(w), round(h), round(d)],
    uv: [round(num(uv.get('u'))), round(num(uv.get('v')))]
  }
  if (cube.get('mirror') === 1) box.mirror = true
  const g = [num(grow.get('growX')), num(grow.get('growY')), num(grow.get('growZ'))].map(round)
  if (g.some((x) => x !== 0))
    box.inflate = g[0] === g[1] && g[1] === g[2] ? g[0]! : (g as [number, number, number])
  const scale = cube.get('texScale')
  if (scale instanceof JObject) {
    const su = num(scale.get('u'))
    const sv = num(scale.get('v'))
    if (su !== 1 || sv !== 1) box.uvScale = [round(su), round(sv)]
  }
  const faces = cube.get('visibleFaces')
  if (faces instanceof JSet && faces.items.length < 6) {
    box.faces = faces.items
      .map((f) => (f instanceof JEnum ? FACE_OF_DIRECTION[f.name] : undefined))
      .filter((f): f is NonNullable<typeof f> => !!f)
  } else if (faces !== undefined && !(faces instanceof JSet))
    throw new Unknown('unknown visible faces')
  return box
}

function sanitizeName(name: string, used: Set<string>): string {
  let base = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_') || 'part'
  if (!/^[a-z0-9_]+$/.test(base)) base = 'part'
  let out = base
  for (let i = 2; used.has(out); i++) out = `${base}_${i}`
  used.add(out)
  return out
}

function convertPart(
  name: string,
  part: JObject,
  parent: [number, number, number],
  used: Set<string>,
  roles: Set<string>
): EntityPart {
  const pose = obj(part.get('partPose'))
  const px = parent[0] + num(pose.get('x'))
  const py = parent[1] + num(pose.get('y'))
  const pz = parent[2] + num(pose.get('z'))
  const out: EntityPart = {
    name: sanitizeName(name, used),
    pivot: [round(px), round(24 - py), round(-pz)],
    boxes: []
  }
  const rx = num(pose.get('xRot'))
  const ry = num(pose.get('yRot'))
  const rz = num(pose.get('zRot'))
  if (rx || ry || rz) out.rotation = [deg(rx), deg(-ry), deg(-rz)]
  const scale = [pose.get('xScale'), pose.get('yScale'), pose.get('zScale')].map((v) =>
    v === undefined ? 1 : num(v)
  )
  if (scale.some((s) => s !== 1)) out.scale = scale.map(round) as [number, number, number]
  const role = ROLE_OF_PART[name]
  if (role && !roles.has(role)) {
    out.role = role
    roles.add(role)
  }
  const cubes = part.get('cubes')
  if (!(cubes instanceof JList)) throw new Unknown('unknown cube list')
  for (const c of cubes.items) out.boxes.push(convertCube(obj(c), px, py, pz))
  const children = part.get('children')
  if (children instanceof JMap) {
    const kids: EntityPart[] = []
    for (const [k, v] of children.entries) {
      if (typeof k !== 'string') throw new Unknown('unknown part name')
      kids.push(convertPart(k, obj(v), [px, py, pz], used, roles))
    }
    if (kids.length) out.children = kids
  } else if (children !== undefined) throw new Unknown('unknown children')
  return out
}

/** Converts one LayerDefinition object; throws Unknown when anything is not computed. */
export function convertLayer(layer: JObject): JarModelLayer {
  const mesh = obj(layer.get('mesh'))
  const material = obj(layer.get('material'))
  const root = obj(mesh.get('root'))
  const used = new Set<string>()
  const roles = new Set<string>()
  const top = convertPart('root', root, [0, 0, 0], used, roles)
  // The root normally has no cubes: its children become the top-level parts.
  const parts =
    top.boxes.length || top.rotation || top.scale || top.pivot.some((v, i) => v !== [0, 24, 0][i])
      ? [top]
      : (top.children ?? [])
  const has = (r: string): boolean => roles.has(r)
  const animation =
    has('rightArm') && has('leftArm') && has('rightLeg') && has('leftLeg')
      ? 'biped'
      : has('frontRightLeg') && has('frontLeftLeg') && has('backRightLeg') && has('backLeftLeg')
        ? 'quadruped'
        : 'none'
  return {
    textureSize: [num(material.get('xTexSize')), num(material.get('yTexSize'))],
    animation,
    parts
  }
}

function layerId(key: JValue): string | null {
  if (!(key instanceof JObject) || key.cls !== MODEL_LAYER_LOCATION) return null
  const model = key.get('model')
  const layer = key.get('layer')
  const path = model instanceof JObject ? model.get('path') : undefined
  if (typeof path !== 'string' || typeof layer !== 'string') return null
  return `${path}#${layer}`
}

export interface ExtractModelsOptions {
  versionId: string
  now?: () => Date
  maxSteps?: number
  onAbort?: (where: string, reason: string) => void
}

/** Interprets the jar's model registry. Never throws for unsupported code: such layers land in `skipped`. */
export function extractEntityModels(
  source: ClassSource,
  options: ExtractModelsOptions
): JarEntityModels {
  const registered = new Map<string, JValue>()
  let aborts = 0
  const interp = new Interpreter(source, {
    maxSteps: options.maxSteps,
    onAbort: (where, reason) => {
      aborts++
      options.onAbort?.(where, reason)
    },
    onMapBuilderPut: (key, value) => {
      const id = layerId(key)
      if (id && !registered.has(id)) registered.set(id, value)
    }
  })
  try {
    interp.invokeStatic(LAYER_DEFINITIONS, 'createRoots', '()Ljava/util/Map;')
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err
    options.onAbort?.('createRoots', err.message)
  }
  const layers: Record<string, JarModelLayer> = {}
  const skipped: string[] = []
  for (const [id, value] of [...registered].sort(([a], [b]) => a.localeCompare(b))) {
    try {
      layers[id] = convertLayer(obj(value, LAYER_DEFINITION))
    } catch (err) {
      if (!(err instanceof Unknown)) throw err
      skipped.push(id)
      options.onAbort?.(`convert ${id}`, err.message)
    }
  }
  return {
    schemaVersion: ENTITY_MODELS_SCHEMA_VERSION,
    versionId: options.versionId,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    layers,
    skipped,
    stats: { steps: interp.stepCount, aborts }
  }
}

/** Convenience for a whole jar file's bytes; returns null when the jar has no readable model code. */
export function extractEntityModelsFromJar(
  jar: Uint8Array,
  options: ExtractModelsOptions
): JarEntityModels | null {
  const entries = modelClassEntries(jar)
  if (!hasReadableModels(entries)) return null
  return extractEntityModels(classSourceFromEntries(entries), options)
}

export function parseEntityModels(text: string): JarEntityModels | null {
  try {
    const data = JSON.parse(text) as JarEntityModels
    return data.schemaVersion === ENTITY_MODELS_SCHEMA_VERSION && data.layers ? data : null
  } catch {
    return null
  }
}

export { strFromU8 }
