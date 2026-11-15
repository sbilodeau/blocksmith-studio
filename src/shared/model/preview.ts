/**
 * 3D preview models (PLAN 3.4). Returned by 'texture.preview' for the texture open in the editor.
 *
 * Coordinates are in texture pixels (1 block = 16 units).
 * - Block elements use Minecraft's block model space: x east, y up, z south, 0..16 per block.
 * - Entity definitions use our own convention (see EntityDefinition): y up, feet at y = 0, the entity faces +z.
 */

export type Vec3 = [number, number, number]
export type FaceName = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'

export interface BlockFace {
  /** Pack-relative PNG path of the texture on this face (resolved from the model's texture variables). */
  texture: string
  /** [u1, v1, u2, v2] in 0..16 texture units (Minecraft model uv). */
  uv: [number, number, number, number]
  rotation?: 0 | 90 | 180 | 270
  /** Biome/color tint index; colors come from BlockPreview.tints. */
  tintindex?: number
}

export interface BlockElement {
  from: Vec3
  to: Vec3
  rotation?: { origin: Vec3; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean }
  /** false = no directional shading (Minecraft "shade": false). */
  shade?: boolean
  faces: Partial<Record<FaceName, BlockFace>>
}

export interface BlockPreview {
  kind: 'block'
  /** Resolved model id, e.g. "minecraft:block/grass_block". */
  modelId: string
  elements: BlockElement[]
  /** Default tint colors by tintindex ("#rrggbb"), e.g. grass and foliage. */
  tints: Record<number, string>
}

/** The texture itself as a flat item sprite extruded 1 px deep (the in-hand look). */
export interface ItemPreview {
  kind: 'item'
}

/** One cube of an entity part, with Minecraft "box UV" texture mapping. */
export interface EntityBox {
  /** Min corner, absolute entity space (pixels, y up, feet at 0, front = +z). */
  origin: Vec3
  /** [width (x), height (y), depth (z)] in pixels (may be 0 for flat planes like ears or fins). */
  size: Vec3
  /** Top-left of the box UV layout in the texture, in pixels. */
  uv: [number, number]
  /** Mirrors the texture horizontally (Minecraft mirrored limbs). */
  mirror?: boolean
  /** Grows the box by this many pixels on every side without changing its UV (overlays like hats). */
  inflate?: number
}

export interface EntityPart {
  name: string
  /** Rotation pivot, absolute entity space. */
  pivot: Vec3
  /** Rest rotation in degrees around x, y, z (applied in that order). */
  rotation?: Vec3
  /** Used by the idle/walk animation. */
  role?:
    | 'head'
    | 'body'
    | 'rightArm'
    | 'leftArm'
    | 'rightLeg'
    | 'leftLeg'
    | 'frontRightLeg'
    | 'frontLeftLeg'
    | 'backRightLeg'
    | 'backLeftLeg'
    | 'tail'
    | 'wing'
  boxes: EntityBox[]
  children?: EntityPart[]
}

export interface EntityDefinition {
  /** e.g. "zombie" */
  id: string
  /** Texture size in pixels the UVs refer to (the actual PNG may be a multiple, e.g. HD packs). */
  textureSize: [number, number]
  /** Pack paths (globs allowed: * and **) of the textures this definition applies to. */
  textures: string[]
  parts: EntityPart[]
  animation?: 'biped' | 'quadruped' | 'none'
}

export interface EntityPreview {
  kind: 'entity'
  definition: EntityDefinition
}

/** Fallback: the texture on a flat plane (entity without definition, GUI, particles, ...). */
export interface FlatPreview {
  kind: 'flat'
}

export type PreviewModel = BlockPreview | ItemPreview | EntityPreview | FlatPreview
