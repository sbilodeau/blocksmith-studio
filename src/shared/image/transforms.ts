import { blank, int, readPixels32, writePixels32 } from './internal'
import type { FlipAxis, RgbaImage, RotateDegrees, RotateDirection } from './types'

/**
 * Returns a new image. 'clockwise' turns right: 90 clockwise maps (x, y) to (h-1-y, x) and swaps width and height.
 * 270 clockwise is the same as 90 counterclockwise.
 */
export function rotateImage(
  img: RgbaImage,
  degrees: RotateDegrees,
  direction: RotateDirection
): RgbaImage {
  if (degrees !== 90 && degrees !== 180 && degrees !== 270) {
    throw new RangeError(`image core: invalid rotation ${degrees}`)
  }
  const { width: w, height: h } = img
  const quarterTurns = ((((direction === 'clockwise' ? degrees : -degrees) / 90) % 4) + 4) % 4
  const src = readPixels32(img)
  if (quarterTurns === 0) return { width: w, height: h, data: img.data.slice() }
  if (quarterTurns === 2) {
    const out = blank(w, h)
    const dst = writePixels32(out)
    for (let i = 0, j = src.length - 1; j >= 0; i++, j--) dst[i] = src[j]
    return out
  }
  // New size: width = old height, height = old width. Walk the destination row by row.
  const out = blank(h, w)
  const dst = writePixels32(out)
  let i = 0
  if (quarterTurns === 1) {
    // Clockwise: destination (x', y') comes from source (x = y', y = h-1-x').
    for (let ny = 0; ny < w; ny++) {
      for (let nx = 0; nx < h; nx++) dst[i++] = src[(h - 1 - nx) * w + ny]
    }
  } else {
    // Counterclockwise: destination (x', y') comes from source (x = w-1-y', y = x').
    for (let ny = 0; ny < w; ny++) {
      const sx = w - 1 - ny
      for (let nx = 0; nx < h; nx++) dst[i++] = src[nx * w + sx]
    }
  }
  return out
}

/** horizontal = mirror left<->right; vertical = mirror top<->bottom. */
export function flipImage(img: RgbaImage, axis: FlipAxis): RgbaImage {
  const { width: w, height: h } = img
  const out = blank(w, h)
  if (axis === 'vertical') {
    const rowBytes = w * 4
    for (let y = 0; y < h; y++) {
      const from = (h - 1 - y) * rowBytes
      out.data.set(img.data.subarray(from, from + rowBytes), y * rowBytes)
    }
    return out
  }
  const src = readPixels32(img)
  const dst = writePixels32(out)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0, sx = row + w - 1; x < w; x++, sx--) dst[row + x] = src[sx]
  }
  return out
}

/**
 * Moves the content by (dx, dy) pixels (positive = right / down). With `wrap`, pixels leaving one edge come back on
 * the opposite edge; without it, the uncovered area is transparent.
 */
export function shiftImage(img: RgbaImage, dx: number, dy: number, wrap: boolean): RgbaImage {
  const { width: w, height: h } = img
  const out = blank(w, h)
  if (w === 0 || h === 0) return out
  const sx = int(dx)
  const sy = int(dy)
  const src = readPixels32(img)
  const dst = writePixels32(out)
  if (wrap) {
    const ox = ((sx % w) + w) % w
    const oy = ((sy % h) + h) % h
    for (let y = 0; y < h; y++) {
      const srcRow = ((y - oy + h) % h) * w
      const dstRow = y * w
      // Destination x in [ox, w) comes from source [0, w - ox); x in [0, ox) from [w - ox, w).
      dst.set(src.subarray(srcRow, srcRow + w - ox), dstRow + ox)
      dst.set(src.subarray(srcRow + w - ox, srcRow + w), dstRow)
    }
    return out
  }
  if (!(Math.abs(sx) < w && Math.abs(sy) < h)) return out
  const x0 = Math.max(0, sx)
  const x1 = Math.min(w, w + sx)
  for (let y = Math.max(0, sy); y < Math.min(h, h + sy); y++) {
    const srcRow = (y - sy) * w
    dst.set(src.subarray(srcRow + x0 - sx, srcRow + x1 - sx), y * w + x0)
  }
  return out
}

/**
 * Nearest-neighbor resize. Each destination pixel samples the source pixel under its center, so integer upscales
 * repeat every pixel exactly and 2x downscales keep the odd columns/rows (1, 3, 5...).
 */
export function resizeNearest(img: RgbaImage, width: number, height: number): RgbaImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RangeError(`image core: invalid image size ${width}x${height}`)
  }
  const out = blank(width, height)
  const { width: sw, height: sh } = img
  if (sw === 0 || sh === 0 || width === 0 || height === 0) return out
  const src = readPixels32(img)
  const dst = writePixels32(out)
  const xMap = new Int32Array(width)
  // Center sampling in exact integer math: floor((x + 0.5) * sw / width).
  for (let x = 0; x < width; x++) xMap[x] = Math.floor(((2 * x + 1) * sw) / (2 * width))
  let i = 0
  for (let y = 0; y < height; y++) {
    const row = Math.floor(((2 * y + 1) * sh) / (2 * height)) * sw
    for (let x = 0; x < width; x++) dst[i++] = src[row + xMap[x]]
  }
  return out
}
