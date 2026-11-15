import { blank, channel, int, normalize, readPixels32 } from './internal'
import type { Rect, Rgba, RgbaImage } from './types'

/** New image; transparent unless `fill` is given. Width and height must be integers >= 0. */
export function createImage(width: number, height: number, fill?: Rgba): RgbaImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RangeError(`image core: invalid image size ${width}x${height}`)
  }
  const img = blank(width, height)
  if (fill) {
    const [r, g, b, a] = normalize(fill)
    if (r | g | b | a) {
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        d[i] = r
        d[i + 1] = g
        d[i + 2] = b
        d[i + 3] = a
      }
    }
  }
  return img
}

export function cloneImage(img: RgbaImage): RgbaImage {
  return { width: img.width, height: img.height, data: img.data.slice() }
}

/** Coordinates are floored, so (1.5, 0) is the pixel (1, 0). */
export function inBounds(img: RgbaImage, x: number, y: number): boolean {
  const ix = int(x)
  const iy = int(y)
  return ix >= 0 && iy >= 0 && ix < img.width && iy < img.height
}

/** Out-of-bounds reads return transparent black [0, 0, 0, 0]. */
export function getPixel(img: RgbaImage, x: number, y: number): Rgba {
  if (!inBounds(img, x, y)) return [0, 0, 0, 0]
  const i = (int(y) * img.width + int(x)) * 4
  const d = img.data
  return [d[i], d[i + 1], d[i + 2], d[i + 3]]
}

/** Mutates. Out-of-bounds writes are ignored. */
export function setPixel(img: RgbaImage, x: number, y: number, color: Rgba): void {
  if (!inBounds(img, x, y)) return
  const i = (int(y) * img.width + int(x)) * 4
  const d = img.data
  d[i] = channel(color[0])
  d[i + 1] = channel(color[1])
  d[i + 2] = channel(color[2])
  d[i + 3] = channel(color[3])
}

/** Same size and bit-identical pixels. */
export function imagesEqual(a: RgbaImage, b: RgbaImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false
  if (a.data === b.data) return true
  const pa = readPixels32(a)
  const pb = readPixels32(b)
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return false
  return true
}

/** Clamps a rect to the image bounds; returns null if empty. */
export function clampRect(img: RgbaImage, rect: Rect): Rect | null {
  const x = int(rect.x)
  const y = int(rect.y)
  const x0 = Math.max(0, x)
  const y0 = Math.max(0, y)
  const x1 = Math.min(img.width, x + int(rect.width))
  const y1 = Math.min(img.height, y + int(rect.height))
  // Written so that NaN anywhere yields null.
  if (!(x1 > x0 && y1 > y0)) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** Copies `rect` (clamped to the image) into a new image; 0x0 when the rect is outside the image. */
export function cropImage(img: RgbaImage, rect: Rect): RgbaImage {
  const r = clampRect(img, rect)
  if (!r) return blank(0, 0)
  const out = blank(r.width, r.height)
  const rowBytes = r.width * 4
  for (let y = 0; y < r.height; y++) {
    const start = ((r.y + y) * img.width + r.x) * 4
    out.data.set(img.data.subarray(start, start + rowBytes), y * rowBytes)
  }
  return out
}

/** Mutates `dst`. `blend` = alpha-composite src over dst; default replaces pixels (including transparency). */
export function pasteImage(
  dst: RgbaImage,
  src: RgbaImage,
  x: number,
  y: number,
  opts?: { blend?: boolean }
): void {
  const dx = int(x)
  const dy = int(y)
  const sx0 = Math.max(0, -dx)
  const sy0 = Math.max(0, -dy)
  const sx1 = Math.min(src.width, dst.width - dx)
  const sy1 = Math.min(src.height, dst.height - dy)
  if (!(sx1 > sx0 && sy1 > sy0)) return
  // Pasting an image (or a view of it) into itself: read from a snapshot so rows are not clobbered.
  const s = src.data.buffer === dst.data.buffer ? src.data.slice() : src.data
  const d = dst.data
  if (!opts?.blend) {
    const rowBytes = (sx1 - sx0) * 4
    for (let sy = sy0; sy < sy1; sy++) {
      const from = (sy * src.width + sx0) * 4
      d.set(s.subarray(from, from + rowBytes), ((sy + dy) * dst.width + sx0 + dx) * 4)
    }
    return
  }
  for (let sy = sy0; sy < sy1; sy++) {
    let si = (sy * src.width + sx0) * 4
    let di = ((sy + dy) * dst.width + sx0 + dx) * 4
    for (let sx = sx0; sx < sx1; sx++, si += 4, di += 4) {
      const sa = s[si + 3]
      if (sa === 0) continue
      if (sa === 255) {
        d[di] = s[si]
        d[di + 1] = s[si + 1]
        d[di + 2] = s[si + 2]
        d[di + 3] = 255
        continue
      }
      // Straight-alpha "over", in units of 1/255^2 to stay in exact integer arithmetic.
      const sw = sa * 255
      const dw = d[di + 3] * (255 - sa)
      const outA = sw + dw
      d[di] = Math.round((s[si] * sw + d[di] * dw) / outA)
      d[di + 1] = Math.round((s[si + 1] * sw + d[di + 1] * dw) / outA)
      d[di + 2] = Math.round((s[si + 2] * sw + d[di + 2] * dw) / outA)
      d[di + 3] = Math.round(outA / 255)
    }
  }
}

/** Mutates: sets every pixel of `rect` (clamped) to transparent. */
export function clearRect(img: RgbaImage, rect: Rect): void {
  const r = clampRect(img, rect)
  if (!r) return
  for (let y = r.y; y < r.y + r.height; y++) {
    const start = (y * img.width + r.x) * 4
    img.data.fill(0, start, start + r.width * 4)
  }
}

/** Internal: `region` clamped to the image, or the whole image when omitted; null when empty. */
export function targetRect(img: RgbaImage, region?: Rect): Rect | null {
  return clampRect(img, region ?? { x: 0, y: 0, width: img.width, height: img.height })
}
