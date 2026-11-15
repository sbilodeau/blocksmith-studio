import { targetRect } from './basics'
import { channel } from './internal'
import type { Rect, RgbaImage } from './types'

/** Calls `fn` with the byte index of every non-transparent pixel of `region` (clamped; whole image if omitted). */
function eachVisiblePixel(img: RgbaImage, region: Rect | undefined, fn: (i: number) => void): void {
  const rc = targetRect(img, region)
  if (!rc) return
  const d = img.data
  for (let y = rc.y; y < rc.y + rc.height; y++) {
    const end = (y * img.width + rc.x + rc.width) * 4
    for (let i = (y * img.width + rc.x) * 4; i < end; i += 4) if (d[i + 3] !== 0) fn(i)
  }
}

/**
 * Mutates (non-transparent pixels only). degrees -360..360
 *
 * HSV hue rotation: saturation and value (and so grays) are kept; positive degrees go red -> yellow -> green.
 * Multiples of 360 are exact no-ops.
 */
export function hueShift(img: RgbaImage, degrees: number, region?: Rect): void {
  if (!Number.isFinite(degrees) || degrees % 360 === 0) return
  // Hue in sixths of a turn, shift normalized to [0, 6).
  const shift = (((degrees / 60) % 6) + 6) % 6
  const d = img.data
  eachVisiblePixel(img, region, (i) => {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const c = max - min
    if (c === 0) return
    let h = max === r ? (g - b) / c : max === g ? (b - r) / c + 2 : (r - g) / c + 4
    h += shift
    if (h < 0) h += 6
    if (h >= 6) h -= 6
    if (h >= 6) h = 0
    const sector = Math.floor(h)
    const x = c * (1 - Math.abs((h % 2) - 1))
    let nr: number, ng: number, nb: number
    switch (sector) {
      case 0:
        nr = c
        ng = x
        nb = 0
        break
      case 1:
        nr = x
        ng = c
        nb = 0
        break
      case 2:
        nr = 0
        ng = c
        nb = x
        break
      case 3:
        nr = 0
        ng = x
        nb = c
        break
      case 4:
        nr = x
        ng = 0
        nb = c
        break
      default:
        nr = c
        ng = 0
        nb = x
    }
    d[i] = channel(nr + min)
    d[i + 1] = channel(ng + min)
    d[i + 2] = channel(nb + min)
  })
}

/**
 * Mutates. delta -1..1
 *
 * HSL saturation with hue and lightness kept: delta < 0 scales saturation by (1 + delta), so -1 gives gray;
 * delta > 0 moves it toward full saturation by `delta` of the remaining distance, so 1 gives fully saturated colors.
 * Grays stay gray. delta 0 is an exact no-op.
 */
export function adjustSaturation(img: RgbaImage, delta: number, region?: Rect): void {
  if (!(delta !== 0 && Number.isFinite(delta))) return
  const dl = Math.max(-1, Math.min(1, delta))
  const d = img.data
  eachVisiblePixel(img, region, (i) => {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const c = max - min
    if (c === 0) return
    // On the 0-255 scale: lightness l and HSL saturation s = c / (255 - |2l - 255|).
    const l = (max + min) / 2
    const s = c / (255 - Math.abs(max + min - 255))
    const ns = dl < 0 ? s * (1 + dl) : s + (1 - s) * dl
    // With hue and lightness fixed, every channel's distance to l scales with the saturation.
    const k = ns / s
    d[i] = channel(l + (r - l) * k)
    d[i + 1] = channel(l + (g - l) * k)
    d[i + 2] = channel(l + (b - l) * k)
  })
}

/**
 * Mutates. delta -1..1
 *
 * HSL lightness with hue and saturation kept: delta > 0 moves lightness toward white by `delta` of the remaining
 * distance (1 = white), delta < 0 scales it by (1 + delta) (-1 = black). delta 0 is an exact no-op.
 */
export function adjustBrightness(img: RgbaImage, delta: number, region?: Rect): void {
  if (!(delta !== 0 && Number.isFinite(delta))) return
  const dl = Math.max(-1, Math.min(1, delta))
  const d = img.data
  eachVisiblePixel(img, region, (i) => {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const c = max - min
    const l = (max + min) / 2
    const nl = dl > 0 ? l + (255 - l) * dl : l * (1 + dl)
    if (c === 0) {
      d[i] = d[i + 1] = d[i + 2] = channel(nl)
      return
    }
    const s = c / (255 - Math.abs(max + min - 255))
    // New chroma for the same saturation at the new lightness; channels keep their offsets from l, scaled.
    const k = (s * (255 - Math.abs(2 * nl - 255))) / c
    d[i] = channel(nl + (r - l) * k)
    d[i + 1] = channel(nl + (g - l) * k)
    d[i + 2] = channel(nl + (b - l) * k)
  })
}
