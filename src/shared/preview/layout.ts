import type { BlockPreview, EntityPart, EntityPreview, PreviewModel } from '../model/preview'
import { boxUvRects, type BoxFace, type UvRect } from './box-uv'
import { entityFitsTexture } from './entities'

/**
 * Text description of how a texture wraps its 3D model, for the AI agents: which rectangle of the texture is the
 * head front, the left leg, the top of the block... Built from the same model as the 3D preview (jar model, built-in
 * definition or block model), so the agent edits the right pixels for each body part.
 */

/** Cubes listed before the rest is summarized (keeps big models like the ender dragon cheap). */
export const MAX_LAYOUT_CUBES = 80

const BOX_FACES: BoxFace[] = ['top', 'bottom', 'right', 'front', 'left', 'back']

function num(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** "x,y wxh" of a UV rectangle scaled to texture pixels (mirrored rects are normalized). */
function rectText(r: UvRect, sx: number, sy: number): { text: string; area: number } {
  const x = Math.min(r.u1, r.u2) * sx
  const y = Math.min(r.v1, r.v2) * sy
  const w = Math.abs(r.u2 - r.u1) * sx
  const h = Math.abs(r.v2 - r.v1) * sy
  return { text: `${num(x)},${num(y)} ${num(w)}x${num(h)}`, area: w * h }
}

function entityLayout(model: EntityPreview, width: number, height: number): string | undefined {
  const def = model.definition
  if (!entityFitsTexture(def, width, height)) return undefined
  const sx = width / def.textureSize[0]
  const sy = height / def.textureSize[1]
  const lines: string[] = []
  let cubes = 0
  let omitted = 0

  const walk = (part: EntityPart, path: string): void => {
    const name = path ? `${path} > ${part.name}` : part.name
    // Rest-pose rotation: the "top" face of a tilted part does not point up in game.
    const rotation = part.rotation?.some((a) => Math.abs(a) >= 1)
      ? `part rotated ${part.rotation.map((a) => `${num(a)}°`).join('/')} (x/y/z)`
      : ''
    part.boxes.forEach((box, i) => {
      if (cubes >= MAX_LAYOUT_CUBES) {
        omitted++
        return
      }
      const rects = boxUvRects(box)
      const faces = (box.faces ?? BOX_FACES)
        .map((f) => ({ f, ...rectText(rects[f], sx, sy) }))
        .filter((r) => r.area > 0)
        .map((r) => `${r.f} ${r.text}`)
      if (faces.length === 0) return
      cubes++
      const label = part.boxes.length > 1 ? `${name} #${i + 1}` : name
      const size = box.size.map(num).join('x')
      const flags = [
        box.mirror ? 'mirrored' : '',
        box.inflate ? 'overlay, drawn slightly larger' : '',
        rotation
      ].filter(Boolean)
      lines.push(
        `- ${label} (cube ${size}${flags.length ? `, ${flags.join(', ')}` : ''}): ${faces.join(' | ')}`
      )
    })
    for (const child of part.children ?? []) walk(child, name)
  }
  for (const part of def.parts) walk(part, '')
  if (lines.length === 0) return undefined
  if (omitted > 0) lines.push(`- ... ${omitted} more cube(s) not listed`)

  const source =
    model.source === 'jar'
      ? 'the exact model read from the Minecraft jar'
      : "Blocksmith Studio's built-in approximation of the model"
  const scale = sx !== 1 || sy !== 1 ? ` (UVs scaled x${num(sx)} to this texture's size)` : ''
  return [
    `3D MODEL LAYOUT: this texture is wrapped around an entity model (${source})${scale}.`,
    'Each cube unfolds into face rectangles in this texture, listed as "face x,y wxh" in texture pixels (origin top-left).',
    '"front" faces the same way as the entity; "right"/"left" are the entity\'s OWN right and left (the right side is on the left of the image when you face the entity); "bottom" is drawn flipped vertically. Pixels outside every rectangle are never visible.',
    'Use these rectangles to find body parts (for example the eyes go on the head front face), keep details inside the right faces, and keep colors continuous across edges where faces meet.',
    ...lines
  ].join('\n')
}

function blockLayout(
  model: BlockPreview,
  texturePath: string,
  width: number,
  height: number
): string | undefined {
  // Animated block textures are vertical strips of square frames; model UVs refer to one frame.
  const frameHeight = height > width && height % width === 0 ? width : height
  const sx = width / 16
  const sy = frameHeight / 16
  const byRect = new Map<string, string[]>()
  model.elements.forEach((el, i) => {
    for (const [face, f] of Object.entries(el.faces)) {
      if (!f || f.texture !== texturePath) continue
      const [u1, v1, u2, v2] = f.uv
      const r = rectText({ u1, v1, u2, v2 }, sx, sy)
      if (r.area === 0) continue
      const extras = [
        f.rotation ? `rotated ${f.rotation}°` : '',
        f.tintindex !== undefined ? 'tinted' : ''
      ]
        .filter(Boolean)
        .join(', ')
      const key = `${r.text}${extras ? ` (${extras})` : ''}`
      const where = model.elements.length > 1 ? `element ${i + 1} ${face}` : face
      byRect.set(key, [...(byRect.get(key) ?? []), where])
    }
  })
  if (byRect.size === 0) return undefined
  const lines = [...byRect.entries()]
    .slice(0, MAX_LAYOUT_CUBES)
    .map(([rect, faces]) => `- ${rect}: ${faces.join(', ')}`)
  const tinted = Object.keys(model.tints).length
    ? ' "tinted" faces are multiplied by a biome color in game (draw them in grays).'
    : ''
  return [
    `3D MODEL LAYOUT: this texture is used by the block model ${model.modelId} (${model.elements.length} element(s), 16 model units = ${width} px).`,
    `Texture rectangles ("x,y wxh" in texture pixels${frameHeight !== height ? ', within one animation frame' : ''}) and the block faces that show them (up/down/north/south/east/west):${tinted}`,
    ...lines
  ].join('\n')
}

/** The layout text for a texture's preview model, or undefined when there is nothing useful to say. */
export function describeModelLayout(
  model: PreviewModel | null | undefined,
  texturePath: string,
  width: number,
  height: number
): string | undefined {
  switch (model?.kind) {
    case 'entity':
      return entityLayout(model, width, height)
    case 'block':
      return blockLayout(model, texturePath, width, height)
    case 'item':
      return '3D MODEL LAYOUT: this item is shown in hand as the flat sprite extruded 1 px deep; transparent pixels are holes and the outline forms the item silhouette.'
    default:
      return undefined
  }
}
