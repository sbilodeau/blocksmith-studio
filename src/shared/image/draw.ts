import { clampRect } from './basics'
import { int, normalize } from './internal'
import type { Point, Rect, Rgba, RgbaImage } from './types'

/** Bresenham line, inclusive of both ends. */
export function linePoints(a: Point, b: Point): Point[] {
  const points: Point[] = []
  bresenham(a, b, (x, y) => {
    points.push({ x, y })
  })
  return points
}

/** Mutates. Pixels of the line outside the image are skipped. */
export function drawLine(img: RgbaImage, a: Point, b: Point, color: Rgba): void {
  const [r, g, bl, al] = normalize(color)
  const { width: w, height: h, data: d } = img
  bresenham(a, b, (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 4
    d[i] = r
    d[i + 1] = g
    d[i + 2] = bl
    d[i + 3] = al
  })
}

/** Mutates: 1-px outline of `rect` after clamping it to the image. Empty rects are a no-op. */
export function drawRect(img: RgbaImage, rect: Rect, color: Rgba): void {
  const rc = clampRect(img, rect)
  if (!rc) return
  const c = normalize(color)
  const x1 = rc.x + rc.width - 1
  const y1 = rc.y + rc.height - 1
  fillSpan(img, rc.x, x1, rc.y, c)
  fillSpan(img, rc.x, x1, y1, c)
  for (let y = rc.y + 1; y < y1; y++) {
    fillSpan(img, rc.x, rc.x, y, c)
    fillSpan(img, x1, x1, y, c)
  }
}

/** Mutates: fills `rect` clamped to the image. Empty rects are a no-op. */
export function fillRect(img: RgbaImage, rect: Rect, color: Rgba): void {
  const rc = clampRect(img, rect)
  if (!rc) return
  const c = normalize(color)
  for (let y = rc.y; y < rc.y + rc.height; y++) fillSpan(img, rc.x, rc.x + rc.width - 1, y, c)
}

/**
 * Paint bucket. tolerance 0-255 (max channel distance). contiguous=false replaces every matching pixel.
 *
 * Matching compares each pixel to the clicked pixel with `colorDistance` (alpha included), except that every fully
 * transparent pixel counts as [0, 0, 0, 0] whatever its hidden RGB, so a transparent area always fills as one.
 * Contiguous fills use the 4-neighbourhood. Returns the number of pixels whose bytes changed.
 */
export function floodFill(
  img: RgbaImage,
  x: number,
  y: number,
  color: Rgba,
  opts?: { tolerance?: number; contiguous?: boolean }
): number {
  const { width: w, height: h, data: d } = img
  const sx = int(x)
  const sy = int(y)
  if (!(sx >= 0 && sy >= 0 && sx < w && sy < h)) return 0
  const [fr, fg, fb, fa] = normalize(color)
  const tol = Math.max(0, opts?.tolerance ?? 0)
  const contiguous = opts?.contiguous ?? true

  const si = (sy * w + sx) * 4
  const seedOpaque = d[si + 3] !== 0
  const r0 = seedOpaque ? d[si] : 0
  const g0 = seedOpaque ? d[si + 1] : 0
  const b0 = seedOpaque ? d[si + 2] : 0
  const a0 = d[si + 3]

  const matches = (p: number): boolean => {
    const i = p * 4
    const a = d[i + 3]
    if (Math.abs(a - a0) > tol) return false
    if (a === 0) return r0 <= tol && g0 <= tol && b0 <= tol
    return (
      Math.abs(d[i] - r0) <= tol && Math.abs(d[i + 1] - g0) <= tol && Math.abs(d[i + 2] - b0) <= tol
    )
  }
  let changed = 0
  const paint = (p: number): void => {
    const i = p * 4
    if (d[i] !== fr || d[i + 1] !== fg || d[i + 2] !== fb || d[i + 3] !== fa) {
      d[i] = fr
      d[i + 1] = fg
      d[i + 2] = fb
      d[i + 3] = fa
      changed++
    }
  }

  if (!contiguous) {
    // Painting a pixel never changes how another pixel matches (the seed color is captured above).
    for (let p = 0, n = w * h; p < n; p++) if (matches(p)) paint(p)
    return changed
  }

  // Iterative 4-neighbour fill: each pixel is marked when pushed, so the stack never exceeds w * h entries.
  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let top = 0
  const start = sy * w + sx
  seen[start] = 1
  stack[top++] = start
  while (top > 0) {
    const p = stack[--top]
    const px = p % w
    if (px > 0 && !seen[p - 1] && matches(p - 1)) {
      seen[p - 1] = 1
      stack[top++] = p - 1
    }
    if (px < w - 1 && !seen[p + 1] && matches(p + 1)) {
      seen[p + 1] = 1
      stack[top++] = p + 1
    }
    if (p >= w && !seen[p - w] && matches(p - w)) {
      seen[p - w] = 1
      stack[top++] = p - w
    }
    if (p + w < w * h && !seen[p + w] && matches(p + w)) {
      seen[p + w] = 1
      stack[top++] = p + w
    }
  }
  // Paint once the region is known, so matching always sees the original pixels.
  for (let p = 0, n = w * h; p < n; p++) if (seen[p]) paint(p)
  return changed
}

/** Returns the points mirrored across the image's vertical (x) and/or horizontal (y) center lines, deduplicated. */
export function mirrorPoints(
  p: Point,
  width: number,
  height: number,
  mirror: { x: boolean; y: boolean }
): Point[] {
  const x = int(p.x)
  const y = int(p.y)
  const mx = width - 1 - x
  const my = height - 1 - y
  const out: Point[] = [{ x, y }]
  const add = (px: number, py: number): void => {
    if (!out.some((q) => q.x === px && q.y === py)) out.push({ x: px, y: py })
  }
  if (mirror.x) add(mx, y)
  if (mirror.y) add(x, my)
  if (mirror.x && mirror.y) add(mx, my)
  return out
}

// ---------- internals ----------

function bresenham(a: Point, b: Point, plot: (x: number, y: number) => void): void {
  let x0 = int(a.x)
  let y0 = int(a.y)
  const x1 = int(b.x)
  const y1 = int(b.y)
  if (!Number.isFinite(x0 + y0 + x1 + y1)) return
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const stepX = x0 < x1 ? 1 : -1
  const stepY = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    plot(x0, y0)
    if (x0 === x1 && y0 === y1) return
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += stepX
    }
    if (e2 <= dx) {
      err += dx
      y0 += stepY
    }
  }
}

/** Sets pixels x0..x1 (inclusive, already in bounds) of row y. */
function fillSpan(img: RgbaImage, x0: number, x1: number, y: number, c: readonly number[]): void {
  const d = img.data
  const end = (y * img.width + x1) * 4
  for (let i = (y * img.width + x0) * 4; i <= end; i += 4) {
    d[i] = c[0]
    d[i + 1] = c[1]
    d[i + 2] = c[2]
    d[i + 3] = c[3]
  }
}
