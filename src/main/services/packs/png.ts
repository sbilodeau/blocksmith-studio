import { convertIndexedToRgb, decode, encode } from 'fast-png'
import { createHash } from 'node:crypto'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const VALID_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16]
}

export interface PngHeader {
  width: number
  height: number
  bitDepth: number
  colorType: number
}

/** Reads the IHDR chunk (signature + first chunk). Returns null when the data is not a well-formed PNG header. */
export function readPngHeader(data: Uint8Array): PngHeader | null {
  if (data.length < 33) return null
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (data[i] !== PNG_SIGNATURE[i]) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const length = view.getUint32(8)
  const type = String.fromCharCode(data[12], data[13], data[14], data[15])
  if (length !== 13 || type !== 'IHDR') return null
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const bitDepth = data[24]
  const colorType = data[25]
  if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) return null
  if (!VALID_DEPTHS[colorType]?.includes(bitDepth)) return null
  return { width, height, bitDepth, colorType }
}

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

/** Decodes any PNG into 8-bit RGBA. */
export function decodeRgba(data: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const png = decode(data)
  const { width, height } = png
  let src: ArrayLike<number> = png.data
  let channels = png.channels
  let depth: number = png.depth
  if (png.palette) {
    src = convertIndexedToRgb(png)
    channels = png.palette[0]?.length ?? 3
    depth = 8
  }
  const rgba = new Uint8Array(width * height * 4)
  const shift = depth === 16 ? 8 : 0
  for (let p = 0; p < width * height; p++) {
    const s = p * channels
    const read = (i: number): number => src[s + i] >> shift
    let r: number, g: number, b: number, a: number
    if (channels === 1 || channels === 2) {
      r = g = b = read(0)
      a = channels === 2 ? read(1) : 255
    } else {
      r = read(0)
      g = read(1)
      b = read(2)
      a = channels === 4 ? read(3) : 255
    }
    rgba.set([r, g, b, a], p * 4)
  }
  return { width, height, rgba }
}

/** Nearest-neighbour scale of the top square of an image (first frame of animated strips). */
function scaleTopSquare(
  img: { width: number; height: number; rgba: Uint8Array },
  size: number
): Uint8Array {
  const side = Math.min(img.width, img.height)
  const out = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    const sy = Math.floor((y * side) / size)
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x * side) / size)
      const s = (sy * img.width + sx) * 4
      out.set(img.rgba.subarray(s, s + 4), (y * size + x) * 4)
    }
  }
  return out
}

/** A simple deterministic 8x8 pixel pattern (scaled up) seeded by a string, with a darker frame. */
function patternIcon(seed: string, size: number): Uint8Array {
  const hash = createHash('sha256').update(seed).digest()
  const base = [64 + (hash[0] % 160), 64 + (hash[1] % 160), 64 + (hash[2] % 160)]
  const out = new Uint8Array(size * size * 4)
  const cell = size / 8
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / cell)
      const cy = Math.floor(y / cell)
      const edge = cx === 0 || cy === 0 || cx === 7 || cy === 7
      // Mirror horizontally so the pattern looks like a little emblem.
      const bit = (hash[4 + cy] >> Math.min(cx, 7 - cx)) & 1
      const factor = edge ? 0.45 : bit ? 1.15 : 0.8
      const i = (y * size + x) * 4
      out[i] = Math.min(255, Math.round(base[0] * factor))
      out[i + 1] = Math.min(255, Math.round(base[1] * factor))
      out[i + 2] = Math.min(255, Math.round(base[2] * factor))
      out[i + 3] = 255
    }
  }
  return out
}

export const PACK_ICON_SIZE = 64

/**
 * Default 64x64 pack.png: a vanilla texture upscaled with nearest-neighbour when one is given and decodes,
 * otherwise a generated pattern seeded by `seed`.
 */
export function createDefaultPackIcon(options: { seed: string; texture?: Uint8Array }): Uint8Array {
  let rgba: Uint8Array | undefined
  if (options.texture) {
    try {
      rgba = scaleTopSquare(decodeRgba(options.texture), PACK_ICON_SIZE)
    } catch {
      rgba = undefined
    }
  }
  rgba ??= patternIcon(options.seed, PACK_ICON_SIZE)
  return encode({
    width: PACK_ICON_SIZE,
    height: PACK_ICON_SIZE,
    data: rgba,
    channels: 4,
    depth: 8
  })
}
