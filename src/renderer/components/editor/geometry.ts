import type { Point, Rect } from '@shared/image'

/** Integer zoom levels (screen pixels per texture pixel). */
export const ZOOM_LEVELS = [1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64]

export function nextZoom(current: number, step: 1 | -1): number {
  if (step > 0) return ZOOM_LEVELS.find((z) => z > current) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1]
  return [...ZOOM_LEVELS].reverse().find((z) => z < current) ?? ZOOM_LEVELS[0]
}

/** Inclusive rectangle spanning two corner pixels. */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 }
}

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height
}

/**
 * Point transforms for mirror painting: identity, plus the mirror across the vertical center line (mirrorX:
 * left <-> right) and/or the horizontal center line (mirrorY: top <-> bottom).
 */
export function mirrorTransforms(
  width: number,
  height: number,
  mirrorX: boolean,
  mirrorY: boolean
): Array<(p: Point) => Point> {
  const list: Array<(p: Point) => Point> = [(p) => p]
  if (mirrorX) list.push((p) => ({ x: width - 1 - p.x, y: p.y }))
  if (mirrorY) list.push((p) => ({ x: p.x, y: height - 1 - p.y }))
  if (mirrorX && mirrorY) list.push((p) => ({ x: width - 1 - p.x, y: height - 1 - p.y }))
  return list
}
