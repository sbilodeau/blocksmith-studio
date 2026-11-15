import * as THREE from 'three'
import type { RgbaImage } from '@shared/image'
import type {
  BlockElement,
  BlockPreview,
  EntityBox,
  EntityDefinition,
  EntityPart,
  FaceName,
  Vec3
} from '@shared/model/preview'
import { boxUvRects, type BoxFace, type UvRect } from '@shared/preview/box-uv'

/**
 * Geometry builders for the 3D preview. All textures are DataTextures uploaded from straight RGBA buffers, row 0
 * = top of the image and no flipY, so texture v grows downward like Minecraft UVs (v = pixelY / height).
 *
 * Quads are given as 4 corners in the order top-left, top-right, bottom-right, bottom-left as seen from outside the
 * face; they get UVs (u1,v1) (u2,v1) (u2,v2) (u1,v2) and counter-clockwise triangles.
 */

export type ShadingMode = 'game' | 'studio'

/** Per-face brightness used by Minecraft's flat block shading. */
const FACE_SHADE: Record<FaceName, number> = {
  up: 1,
  down: 0.5,
  north: 0.8,
  south: 0.8,
  east: 0.6,
  west: 0.6
}

/** Our entity box faces mapped to the block face whose orientation they share (entity faces +z). */
const BOX_FACE_DIRECTION: Record<BoxFace, FaceName> = {
  front: 'south',
  back: 'north',
  right: 'west',
  left: 'east',
  top: 'up',
  bottom: 'down'
}

type Corners = [Vec3, Vec3, Vec3, Vec3]

export function faceCorners(face: FaceName, from: Vec3, to: Vec3): Corners {
  const [x1, y1, z1] = from
  const [x2, y2, z2] = to
  switch (face) {
    case 'north':
      return [
        [x2, y2, z1],
        [x1, y2, z1],
        [x1, y1, z1],
        [x2, y1, z1]
      ]
    case 'south':
      return [
        [x1, y2, z2],
        [x2, y2, z2],
        [x2, y1, z2],
        [x1, y1, z2]
      ]
    case 'east':
      return [
        [x2, y2, z2],
        [x2, y2, z1],
        [x2, y1, z1],
        [x2, y1, z2]
      ]
    case 'west':
      return [
        [x1, y2, z1],
        [x1, y2, z2],
        [x1, y1, z2],
        [x1, y1, z1]
      ]
    case 'up':
      return [
        [x1, y2, z1],
        [x2, y2, z1],
        [x2, y2, z2],
        [x1, y2, z2]
      ]
    case 'down':
      return [
        [x1, y1, z2],
        [x2, y1, z2],
        [x2, y1, z1],
        [x1, y1, z1]
      ]
  }
}

/** Accumulates quads for one material, then produces a BufferGeometry. */
class QuadBuilder {
  positions: number[] = []
  uvs: number[] = []
  colors: number[] = []
  indices: number[] = []

  add(corners: Corners, uv: [number, number][], color: [number, number, number]): void {
    const base = this.positions.length / 3
    for (let i = 0; i < 4; i++) {
      this.positions.push(...corners[i])
      this.uvs.push(...uv[i])
      this.colors.push(...color)
    }
    this.indices.push(base, base + 3, base + 2, base, base + 2, base + 1)
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3))
    g.setIndex(this.indices)
    g.computeVertexNormals()
    return g
  }
}

/** UVs for the 4 corners of a rect (texture pixels -> 0..1), rotated by `rotation` degrees clockwise. */
function rectUvs(r: UvRect, width: number, height: number, rotation = 0): [number, number][] {
  const pts: [number, number][] = [
    [r.u1 / width, r.v1 / height],
    [r.u2 / width, r.v1 / height],
    [r.u2 / width, r.v2 / height],
    [r.u1 / width, r.v2 / height]
  ]
  const steps = (((rotation / 90) % 4) + 4) % 4
  for (let i = 0; i < steps; i++) pts.unshift(pts.pop()!)
  return pts
}

export function makeMaterial(
  texture: THREE.Texture,
  mode: ShadingMode,
  translucent: boolean,
  doubleSide = false
): THREE.Material {
  const common = {
    map: texture,
    vertexColors: true,
    transparent: translucent,
    alphaTest: translucent ? 0.01 : 0.5,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide
  }
  return mode === 'game'
    ? new THREE.MeshBasicMaterial(common)
    : new THREE.MeshLambertMaterial(common)
}

export function hasPartialAlpha(img: RgbaImage): boolean {
  for (let i = 3; i < img.data.length; i += 4) {
    const a = img.data[i]
    if (a > 0 && a < 255) return true
  }
  return false
}

function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex)
  return [c.r, c.g, c.b]
}

export interface TextureSlot {
  texture: THREE.DataTexture
  image: RgbaImage
  /** Height of one animation frame in pixels (== image.height when not animated). */
  frameHeight: number
}

// ---------- blocks ----------
export function buildBlock(
  model: BlockPreview,
  textures: Map<string, TextureSlot>,
  mode: ShadingMode
): THREE.Group {
  const group = new THREE.Group()
  const byTexture = new Map<string, QuadBuilder>()

  for (const el of model.elements) {
    const elementGroup = elementPivot(el)
    const local = new Map<string, QuadBuilder>()
    for (const [name, face] of Object.entries(el.faces) as Array<
      [FaceName, NonNullable<BlockElement['faces'][FaceName]>]
    >) {
      const slot = textures.get(face.texture)
      if (!slot) continue
      const shade = mode === 'game' && el.shade !== false ? FACE_SHADE[name] : 1
      const tint =
        face.tintindex !== undefined
          ? hexToRgb(model.tints[face.tintindex] ?? '#91bd59')
          : [1, 1, 1]
      const color: [number, number, number] = [tint[0] * shade, tint[1] * shade, tint[2] * shade]
      const [u1, v1, u2, v2] = face.uv
      // Block uv is 0..16 over one frame of the texture.
      const uv = rectUvs({ u1, v1, u2, v2 }, 16, 16, face.rotation ?? 0)
      const qb = local.get(face.texture) ?? new QuadBuilder()
      qb.add(faceCorners(name, el.from, el.to), uv, color)
      local.set(face.texture, qb)
    }
    if (!elementGroup) {
      for (const [tex, qb] of local) {
        const target = byTexture.get(tex) ?? new QuadBuilder()
        target.positions.push(...qb.positions)
        target.uvs.push(...qb.uvs)
        target.colors.push(...qb.colors)
        const base = target.positions.length / 3 - qb.positions.length / 3
        target.indices.push(...qb.indices.map((i) => i + base))
        byTexture.set(tex, target)
      }
    } else {
      for (const [tex, qb] of local) {
        const slot = textures.get(tex)!
        elementGroup.inner.add(
          new THREE.Mesh(
            qb.build(),
            makeMaterial(slot.texture, mode, hasPartialAlpha(slot.image), true)
          )
        )
      }
      group.add(elementGroup.outer)
    }
  }

  for (const [tex, qb] of byTexture) {
    const slot = textures.get(tex)!
    const mesh = new THREE.Mesh(
      qb.build(),
      makeMaterial(slot.texture, mode, hasPartialAlpha(slot.image))
    )
    mesh.userData['texture'] = tex
    group.add(mesh)
  }
  for (const child of group.children) tagTextures(child)
  // Center the 16x16x16 block on the origin.
  group.position.set(-8, -8, -8)
  const wrapper = new THREE.Group()
  wrapper.add(group)
  return wrapper
}

function tagTextures(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh
    const mat = mesh.material as THREE.MeshBasicMaterial | undefined
    if (mat?.map) mesh.userData['textureObject'] = mat.map
  })
}

/** Elements with a rotation get their own pivot group (rotation around `origin` on one axis, optional rescale). */
function elementPivot(el: BlockElement): { outer: THREE.Group; inner: THREE.Group } | null {
  if (!el.rotation || el.rotation.angle === 0) return null
  const { origin, axis, angle, rescale } = el.rotation
  const outer = new THREE.Group()
  outer.position.set(...origin)
  const rad = THREE.MathUtils.degToRad(angle)
  outer.rotation[axis] = rad
  if (rescale) {
    const s = 1 / Math.cos(Math.abs(rad))
    outer.scale.set(axis === 'x' ? 1 : s, axis === 'y' ? 1 : s, axis === 'z' ? 1 : s)
  }
  const inner = new THREE.Group()
  inner.position.set(-origin[0], -origin[1], -origin[2])
  outer.add(inner)
  return { outer, inner }
}

// ---------- items (extruded sprite) ----------
export function buildItem(slot: TextureSlot, mode: ShadingMode): THREE.Group {
  const { image } = slot
  const w = image.width
  const h = slot.frameHeight
  const depth = 1
  const qb = new QuadBuilder()
  const full: UvRect = { u1: 0, v1: 0, u2: w, v2: h }
  const color = (f: FaceName): [number, number, number] => {
    const s = mode === 'game' ? FACE_SHADE[f] : 1
    return [s, s, s]
  }
  const from: Vec3 = [0, 0, 0]
  const to: Vec3 = [w, h, depth]
  qb.add(faceCorners('south', from, to), rectUvs(full, w, h), color('south'))
  qb.add(
    faceCorners('north', from, to),
    rectUvs({ u1: w, v1: 0, u2: 0, v2: h }, w, h),
    color('north')
  )

  // Side walls only where an opaque pixel borders a transparent one (or the edge), textured with that pixel.
  const opaque = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && image.data[(y * w + x) * 4 + 3] >= 128
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaque(x, y)) continue
      const px: UvRect = { u1: x + 0.25, v1: y + 0.25, u2: x + 0.75, v2: y + 0.75 }
      const top = h - y
      const bottom = h - y - 1
      if (!opaque(x - 1, y))
        qb.add(
          faceCorners('west', [x, bottom, 0], [x + 1, top, depth]),
          rectUvs(px, w, h),
          color('west')
        )
      if (!opaque(x + 1, y))
        qb.add(
          faceCorners('east', [x, bottom, 0], [x + 1, top, depth]),
          rectUvs(px, w, h),
          color('east')
        )
      if (!opaque(x, y - 1))
        qb.add(
          faceCorners('up', [x, bottom, 0], [x + 1, top, depth]),
          rectUvs(px, w, h),
          color('up')
        )
      if (!opaque(x, y + 1))
        qb.add(
          faceCorners('down', [x, bottom, 0], [x + 1, top, depth]),
          rectUvs(px, w, h),
          color('down')
        )
    }
  }
  const mesh = new THREE.Mesh(qb.build(), makeMaterial(slot.texture, mode, false))
  mesh.position.set(-w / 2, -h / 2, -depth / 2)
  mesh.userData['textureObject'] = slot.texture
  const group = new THREE.Group()
  // Scale so a 16 px sprite is the size of a block.
  group.scale.setScalar(16 / Math.max(w, h))
  group.add(mesh)
  return group
}

// ---------- entities ----------
export interface EntityRig {
  group: THREE.Group
  /** Part pivots by role, for the walk animation. */
  roles: Map<string, THREE.Object3D>
}

export function buildEntity(
  def: EntityDefinition,
  slot: TextureSlot,
  mode: ShadingMode
): EntityRig {
  const [tw, th] = def.textureSize
  const roles = new Map<string, THREE.Object3D>()
  const translucent = hasPartialAlpha(slot.image)

  const buildPart = (part: EntityPart, parentPivot: Vec3): THREE.Object3D => {
    const pivot = new THREE.Group()
    pivot.name = part.name
    pivot.position.set(
      part.pivot[0] - parentPivot[0],
      part.pivot[1] - parentPivot[1],
      part.pivot[2] - parentPivot[2]
    )
    if (part.rotation) {
      // Minecraft applies part rotations x, then y, then z (matrix Rz * Ry * Rx = three.js order 'ZYX').
      pivot.rotation.set(...(part.rotation.map((d) => THREE.MathUtils.degToRad(d)) as Vec3), 'ZYX')
    }
    pivot.userData['rest'] = pivot.rotation.clone()
    if (part.role) roles.set(part.role, pivot)
    const qb = new QuadBuilder()
    let flat = false
    for (const box of part.boxes) {
      flat ||= box.size.some((s) => s === 0) || (box.inflate ?? 0) > 0
      addBox(qb, box, part.pivot, tw, th, mode)
    }
    if (qb.positions.length) {
      const mesh = new THREE.Mesh(qb.build(), makeMaterial(slot.texture, mode, translucent, flat))
      mesh.userData['textureObject'] = slot.texture
      pivot.add(mesh)
    }
    for (const child of part.children ?? []) pivot.add(buildPart(child, part.pivot))
    return pivot
  }

  const group = new THREE.Group()
  for (const part of def.parts) group.add(buildPart(part, [0, 0, 0]))
  return { group, roles }
}

function addBox(
  qb: QuadBuilder,
  box: EntityBox,
  pivot: Vec3,
  tw: number,
  th: number,
  mode: ShadingMode
): void {
  const inflate = box.inflate ?? 0
  const from: Vec3 = [
    box.origin[0] - inflate - pivot[0],
    box.origin[1] - inflate - pivot[1],
    box.origin[2] - inflate - pivot[2]
  ]
  const to: Vec3 = [
    box.origin[0] + box.size[0] + inflate - pivot[0],
    box.origin[1] + box.size[1] + inflate - pivot[1],
    box.origin[2] + box.size[2] + inflate - pivot[2]
  ]
  const rects = boxUvRects(box)
  for (const face of Object.keys(rects) as BoxFace[]) {
    const r = rects[face]
    if (r.u1 === r.u2 || r.v1 === r.v2) continue // zero-area face of a flat plane
    const dir = BOX_FACE_DIRECTION[face]
    const s = mode === 'game' ? FACE_SHADE[dir] : 1
    qb.add(faceCorners(dir, from, to), rectUvs(r, tw, th), [s, s, s])
  }
}

// ---------- flat fallback ----------
export function buildFlat(slot: TextureSlot): THREE.Group {
  const w = slot.image.width
  const h = slot.frameHeight
  const qb = new QuadBuilder()
  qb.add(
    faceCorners('south', [0, 0, 0], [w, h, 0]),
    rectUvs({ u1: 0, v1: 0, u2: w, v2: h }, w, h),
    [1, 1, 1]
  )
  const mesh = new THREE.Mesh(
    qb.build(),
    makeMaterial(slot.texture, 'game', hasPartialAlpha(slot.image), true)
  )
  mesh.position.set(-w / 2, -h / 2, 0)
  mesh.userData['textureObject'] = slot.texture
  const group = new THREE.Group()
  group.scale.setScalar(24 / Math.max(w, h))
  group.add(mesh)
  return group
}

/** DataTexture for a straight-RGBA image with crisp pixels; for animated strips, shows one frame at a time. */
export function makeDataTexture(image: RgbaImage, frameHeight: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Uint8Array(image.data),
    image.width,
    image.height,
    THREE.RGBAFormat
  )
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  tex.flipY = false
  tex.repeat.set(1, frameHeight / image.height)
  tex.needsUpdate = true
  return tex
}

/** Updates a DataTexture in place from an image of the same size (live painting). */
export function updateDataTexture(
  tex: THREE.DataTexture,
  image: RgbaImage,
  highlight?: { x: number; y: number }
): boolean {
  const data = tex.image.data as Uint8Array
  if (tex.image.width !== image.width || tex.image.height !== image.height) return false
  data.set(image.data)
  if (
    highlight &&
    highlight.x >= 0 &&
    highlight.y >= 0 &&
    highlight.x < image.width &&
    highlight.y < image.height
  ) {
    const i = (highlight.y * image.width + highlight.x) * 4
    // Highlight the linked pixel: invert its color and make it opaque.
    data[i] = 255 - data[i]
    data[i + 1] = 255 - data[i + 1]
    data[i + 2] = 255 - data[i + 2]
    data[i + 3] = 255
  }
  tex.needsUpdate = true
  return true
}

/** Shows animation frame `index` of a strip texture. */
export function setFrame(
  tex: THREE.Texture,
  index: number,
  frameHeight: number,
  imageHeight: number
): void {
  const frames = Math.max(1, Math.floor(imageHeight / frameHeight))
  tex.offset.set(0, ((index % frames) * frameHeight) / imageHeight)
}

export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh
    mesh.geometry?.dispose()
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else mat?.dispose()
  })
}
