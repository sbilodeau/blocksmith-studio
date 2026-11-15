import type { EntityBox } from '../model/preview'

/**
 * Minecraft "box UV" layout for a cube of size (w, h, d) whose layout starts at (u, v):
 *
 *            u     u+d    u+d+w  u+d+w+d  u+2d+2w
 *     v      .     [ top ][bottom]  .
 *     v+d    [right][front][ left ][ back ]
 *     v+d+h
 *
 * "right"/"left" are the entity's own sides. With our entity convention (entity faces +z, y up), the entity's
 * right side is the -x face and its left side the +x face.
 */
export type BoxFace = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back'

/** Axis-aligned UV rectangle in texture pixels; u2 < u1 (or v2 < v1) means the texture is mirrored on that axis. */
export interface UvRect {
  u1: number
  v1: number
  u2: number
  v2: number
}

export function boxUvRects(
  box: Pick<EntityBox, 'size' | 'uv' | 'mirror'>
): Record<BoxFace, UvRect> {
  const [w, h, d] = box.size
  const [u, v] = box.uv
  const rects: Record<BoxFace, UvRect> = {
    top: { u1: u + d, v1: v, u2: u + d + w, v2: v + d },
    // Minecraft draws the bottom face flipped vertically.
    bottom: { u1: u + d + w, v1: v + d, u2: u + d + 2 * w, v2: v },
    right: { u1: u, v1: v + d, u2: u + d, v2: v + d + h },
    front: { u1: u + d, v1: v + d, u2: u + d + w, v2: v + d + h },
    left: { u1: u + d + w, v1: v + d, u2: u + 2 * d + w, v2: v + d + h },
    back: { u1: u + 2 * d + w, v1: v + d, u2: u + 2 * d + 2 * w, v2: v + d + h }
  }
  if (!box.mirror) return rects
  // Mirrored boxes swap the side strips and flip every face horizontally.
  const flip = (r: UvRect): UvRect => ({ u1: r.u2, v1: r.v1, u2: r.u1, v2: r.v2 })
  return {
    top: flip(rects.top),
    bottom: flip(rects.bottom),
    right: flip(rects.left),
    front: flip(rects.front),
    left: flip(rects.right),
    back: flip(rects.back)
  }
}

/** Total pixel area covered by a box's UV layout: (2d + 2w) x (d + h). */
export function boxUvExtent(box: Pick<EntityBox, 'size' | 'uv'>): UvRect {
  const [w, h, d] = box.size
  const [u, v] = box.uv
  return { u1: u, v1: v, u2: u + 2 * d + 2 * w, v2: v + d + h }
}
