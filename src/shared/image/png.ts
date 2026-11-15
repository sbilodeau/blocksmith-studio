import { decode, encode } from 'fast-png'
import { blank } from './internal'
import type { RgbaImage } from './types'

/**
 * Decodes any PNG (palette, grayscale, 16-bit, with or without alpha) to RGBA8 with exact values.
 *
 * Conversions: 16-bit samples keep their high byte (v >> 8); 1/2/4-bit grayscale is scaled to 0-255 (x255, x85,
 * x17); tRNS transparency is applied for palette, grayscale and RGB images; a palette index past the end of the
 * palette decodes as opaque black. Throws on invalid or unsupported data.
 */
export function decodePng(bytes: Uint8Array): RgbaImage {
  const png = decode(bytes)
  const { width, height, depth, channels } = png
  // IHDR interlace byte (offset 28). fast-png 8 de-interlaces 1/2/4-bit Adam7 images incorrectly: refuse them.
  if (depth < 8 && bytes[28] === 1) {
    throw new Error(`image core: interlaced ${depth}-bit PNGs are not supported`)
  }
  const n = width * height
  const out = blank(width, height)
  const o = out.data
  if (depth === 8 && channels === 4) {
    o.set(png.data.subarray(0, n * 4))
    return out
  }

  // One sample per channel per pixel at the original depth (1/2/4-bit rows are unpacked here).
  const samples = depth < 8 ? unpackLowDepth(png.data, width, height, depth) : png.data
  const shift = depth === 16 ? 8 : 0

  if (channels === 1 && png.palette) {
    const lut = new Uint8Array(256 * 4)
    for (let k = 0; k < 256; k++) lut[k * 4 + 3] = 255
    png.palette.forEach((entry, k) => {
      if (k >= 256) return
      lut[k * 4] = entry[0]
      lut[k * 4 + 1] = entry[1]
      lut[k * 4 + 2] = entry[2]
      lut[k * 4 + 3] = entry.length > 3 ? entry[3] : 255
    })
    for (let p = 0; p < n; p++) {
      const k = samples[p] * 4
      o[p * 4] = lut[k]
      o[p * 4 + 1] = lut[k + 1]
      o[p * 4 + 2] = lut[k + 2]
      o[p * 4 + 3] = lut[k + 3]
    }
    return out
  }

  const trns = png.transparency
  switch (channels) {
    case 1: {
      const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1
      const key = trns && trns.length >= 1 ? trns[0] : -1
      for (let p = 0; p < n; p++) {
        const raw = samples[p]
        const v = depth < 8 ? raw * scale : raw >> shift
        o[p * 4] = o[p * 4 + 1] = o[p * 4 + 2] = v
        o[p * 4 + 3] = raw === key ? 0 : 255
      }
      return out
    }
    case 2:
      for (let p = 0; p < n; p++) {
        const v = samples[p * 2] >> shift
        o[p * 4] = o[p * 4 + 1] = o[p * 4 + 2] = v
        o[p * 4 + 3] = samples[p * 2 + 1] >> shift
      }
      return out
    case 3: {
      const hasKey = !!trns && trns.length >= 3
      const kr = hasKey ? trns[0] : -1
      const kg = hasKey ? trns[1] : -1
      const kb = hasKey ? trns[2] : -1
      for (let p = 0; p < n; p++) {
        const r = samples[p * 3]
        const g = samples[p * 3 + 1]
        const b = samples[p * 3 + 2]
        o[p * 4] = r >> shift
        o[p * 4 + 1] = g >> shift
        o[p * 4 + 2] = b >> shift
        o[p * 4 + 3] = r === kr && g === kg && b === kb ? 0 : 255
      }
      return out
    }
    case 4:
      for (let i = 0; i < n * 4; i++) o[i] = samples[i] >> shift
      return out
    default:
      throw new Error(`image core: unsupported PNG (${channels} channels, ${depth}-bit)`)
  }
}

/** Encodes RGBA8, lossless. Throws for an empty (0-pixel) image, which PNG cannot represent. */
export function encodePng(img: RgbaImage): Uint8Array {
  return encode({ width: img.width, height: img.height, data: img.data, channels: 4, depth: 8 })
}

/** Unpacks 1/2/4-bit single-channel rows (each row starts on a byte boundary) to one byte per pixel. */
function unpackLowDepth(
  data: ArrayLike<number>,
  width: number,
  height: number,
  depth: number
): Uint8Array {
  const out = new Uint8Array(width * height)
  const stride = Math.ceil((width * depth) / 8)
  const mask = (1 << depth) - 1
  for (let y = 0, p = 0; y < height; y++) {
    const row = y * stride
    for (let x = 0; x < width; x++, p++) {
      const bit = x * depth
      out[p] = (data[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & mask
    }
  }
  return out
}
