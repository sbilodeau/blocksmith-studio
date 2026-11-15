import { targetRect } from './basics'
import { channel, normalize, packRgba } from './internal'
import type { PaletteEntry, Rect, Rgba, RgbaImage } from './types'

const HEX_RE = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** Accepts '#rgb', '#rgba', '#rrggbb' or '#rrggbbaa' ('#' optional, any case). Throws on anything else. */
export function parseHex(hex: string): Rgba {
  const m = typeof hex === 'string' ? HEX_RE.exec(hex.trim()) : null
  if (!m) throw new Error(`image core: invalid hex color ${JSON.stringify(hex)}`)
  let digits = m[1]
  if (digits.length <= 4) digits = [...digits].map((c) => c + c).join('')
  if (digits.length === 6) digits += 'ff'
  const n = parseInt(digits, 16)
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
}

/** '#rrggbbaa' (lowercase). */
export function toHex(color: Rgba): string {
  const [r, g, b, a] = normalize(color)
  return '#' + packRgba(r, g, b, a).toString(16).padStart(8, '0')
}

export function rgbaEquals(a: Rgba, b: Rgba): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

/** Max absolute channel difference (0-255), alpha included. */
export function colorDistance(a: Rgba, b: Rgba): number {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
    Math.abs(a[3] - b[3])
  )
}

/**
 * Distinct colors sorted by pixel count (desc), fully transparent pixels ignored. Ties are sorted by hex value (asc)
 * so the output is stable; `max` keeps only the first entries.
 */
export function extractPalette(img: RgbaImage, opts?: { max?: number }): PaletteEntry[] {
  const d = img.data
  const counts = new Map<number, number>()
  // Runs of the same color are common in textures: count them before touching the map.
  let runKey = -1
  let runCount = 0
  for (let i = 0, n = img.width * img.height * 4; i < n; i += 4) {
    if (d[i + 3] === 0) continue
    const key = packRgba(d[i], d[i + 1], d[i + 2], d[i + 3])
    if (key === runKey) {
      runCount++
      continue
    }
    if (runCount > 0) counts.set(runKey, (counts.get(runKey) ?? 0) + runCount)
    runKey = key
    runCount = 1
  }
  if (runCount > 0) counts.set(runKey, (counts.get(runKey) ?? 0) + runCount)
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  const max = opts?.max
  const kept = max === undefined ? sorted : sorted.slice(0, Math.max(0, Math.floor(max)))
  return kept.map(([key, count]) => ({
    color: [key >>> 24, (key >>> 16) & 255, (key >>> 8) & 255, key & 255],
    count
  }))
}

/**
 * Mutates. Returns the number of pixels changed. Every pixel within `tolerance` (max channel distance, alpha
 * included, default 0) of `from` becomes `to`. Fully transparent pixels compare as [0, 0, 0, 0] whatever their hidden
 * RGB (and so does a `from` with alpha 0).
 */
export function replaceColor(img: RgbaImage, from: Rgba, to: Rgba, tolerance?: number): number {
  const tol = Math.max(0, tolerance ?? 0)
  const f = normalize(from)
  const a0 = f[3]
  const [r0, g0, b0] = a0 === 0 ? [0, 0, 0] : f
  const [r1, g1, b1, a1] = normalize(to)
  const d = img.data
  let changed = 0
  for (let i = 0, n = img.width * img.height * 4; i < n; i += 4) {
    const a = d[i + 3]
    if (Math.abs(a - a0) > tol) continue
    if (a === 0) {
      if (r0 > tol || g0 > tol || b0 > tol) continue
    } else if (
      Math.abs(d[i] - r0) > tol ||
      Math.abs(d[i + 1] - g0) > tol ||
      Math.abs(d[i + 2] - b0) > tol
    ) {
      continue
    }
    if (d[i] !== r1 || d[i + 1] !== g1 || d[i + 2] !== b1 || a !== a1) {
      d[i] = r1
      d[i + 1] = g1
      d[i + 2] = b1
      d[i + 3] = a1
      changed++
    }
  }
  return changed
}

/**
 * Mutates: maps every non-transparent pixel (alpha > 0) to the nearest palette color by Euclidean RGB distance
 * (ties: first palette entry). Each pixel keeps its own alpha; palette alpha is ignored. Empty palette: no-op.
 */
export function applyPalette(img: RgbaImage, palette: readonly Rgba[], region?: Rect): void {
  const rc = targetRect(img, region)
  if (!rc || palette.length === 0) return
  const n = palette.length
  const pal = new Int32Array(n * 3)
  palette.forEach((c, k) => {
    pal[k * 3] = channel(c[0])
    pal[k * 3 + 1] = channel(c[1])
    pal[k * 3 + 2] = channel(c[2])
  })
  const d = img.data
  for (let y = rc.y; y < rc.y + rc.height; y++) {
    const end = (y * img.width + rc.x + rc.width) * 4
    for (let i = (y * img.width + rc.x) * 4; i < end; i += 4) {
      if (d[i + 3] === 0) continue
      const r = d[i]
      const g = d[i + 1]
      const b = d[i + 2]
      let best = 0
      let bestDist = Infinity
      for (let k = 0; k < n * 3; k += 3) {
        const dr = r - pal[k]
        const dg = g - pal[k + 1]
        const db = b - pal[k + 2]
        const dist = dr * dr + dg * dg + db * db
        if (dist < bestDist) {
          bestDist = dist
          best = k
          if (dist === 0) break
        }
      }
      d[i] = pal[best]
      d[i + 1] = pal[best + 1]
      d[i + 2] = pal[best + 2]
    }
  }
}

/**
 * Mutates: draws a 1-px outline around opaque shapes, outside (on transparent neighbours) or inside (edge pixels).
 *
 * "Opaque" means alpha > 0. 'outside' paints transparent pixels that 4-touch an opaque pixel; 'inside' paints opaque
 * pixels that 4-touch a transparent pixel or the image border. Computed from a snapshot, so it never cascades.
 */
export function outline(img: RgbaImage, color: Rgba, mode: 'inside' | 'outside'): void {
  const { width: w, height: h, data: d } = img
  const n = w * h
  const opaque = new Uint8Array(n)
  for (let p = 0; p < n; p++) opaque[p] = d[p * 4 + 3] === 0 ? 0 : 1
  const [r, g, b, a] = normalize(color)
  const inside = mode === 'inside'
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      let hit: boolean
      if (inside) {
        hit =
          opaque[p] === 1 &&
          (x === 0 ||
            y === 0 ||
            x === w - 1 ||
            y === h - 1 ||
            !opaque[p - 1] ||
            !opaque[p + 1] ||
            !opaque[p - w] ||
            !opaque[p + w])
      } else {
        hit =
          opaque[p] === 0 &&
          ((x > 0 && opaque[p - 1] === 1) ||
            (x < w - 1 && opaque[p + 1] === 1) ||
            (y > 0 && opaque[p - w] === 1) ||
            (y < h - 1 && opaque[p + w] === 1))
      }
      if (hit) {
        const i = p * 4
        d[i] = r
        d[i + 1] = g
        d[i + 2] = b
        d[i + 3] = a
      }
    }
  }
}
