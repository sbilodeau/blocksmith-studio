import { describe, expect, it } from 'vitest'
import { encode } from 'fast-png'
import {
  createImage,
  decodePng,
  encodePng,
  getPixel,
  imagesEqual,
  type RgbaImage
} from '@shared/image'

function noise(w: number, h: number, seed = 1): RgbaImage {
  const img = createImage(w, h)
  let s = seed
  for (let i = 0; i < img.data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0
    img.data[i] = s >>> 24
  }
  return img
}

const pixels = (img: RgbaImage): number[][] =>
  Array.from({ length: img.width * img.height }, (_, p) => [
    ...getPixel(img, p % img.width, Math.floor(p / img.width))
  ])

// ---- hand-made chunks (fast-png cannot write tRNS for grayscale / RGB images) ----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, payload: number[]): Uint8Array {
  const out = new Uint8Array(12 + payload.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, payload.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(payload, 8)
  view.setUint32(8 + payload.length, crc32(out.subarray(4, 8 + payload.length)))
  return out
}

/** Inserts a chunk right after IHDR (signature 8 bytes + IHDR chunk 25 bytes). */
function insertAfterIhdr(png: Uint8Array, extra: Uint8Array): Uint8Array {
  const out = new Uint8Array(png.length + extra.length)
  out.set(png.subarray(0, 33))
  out.set(extra, 33)
  out.set(png.subarray(33), 33 + extra.length)
  return out
}

describe('encodePng / decodePng round trip', () => {
  it.each([
    [1, 1],
    [7, 5],
    [16, 16],
    [64, 3]
  ])('is bit-exact for %ix%i images with every alpha value', (w, h) => {
    const img = noise(w, h, w * 31 + h)
    const bytes = encodePng(img)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect([...bytes.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]) // "PNG"
    const back = decodePng(bytes)
    expect(back.data).toBeInstanceOf(Uint8ClampedArray)
    expect(imagesEqual(back, img)).toBe(true)
  })

  it('keeps hidden RGB under alpha 0', () => {
    const img = createImage(2, 1, [12, 34, 56, 0])
    expect([...decodePng(encodePng(img)).data]).toEqual([12, 34, 56, 0, 12, 34, 56, 0])
  })

  it('throws for empty images and invalid data', () => {
    expect(() => encodePng(createImage(0, 0))).toThrow()
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4]))).toThrow()
  })

  it('accepts a subarray with a byte offset', () => {
    const img = noise(5, 4)
    const bytes = encodePng(img)
    const padded = new Uint8Array(bytes.length + 3)
    padded.set(bytes, 3)
    expect(imagesEqual(decodePng(padded.subarray(3)), img)).toBe(true)
  })

  it('decodes Adam7-interlaced 8-bit RGBA', () => {
    const img = noise(11, 9, 4)
    const bytes = encode(
      { width: 11, height: 9, data: img.data, channels: 4, depth: 8 },
      { interlace: 'Adam7' }
    )
    expect(bytes[28]).toBe(1)
    expect(imagesEqual(decodePng(bytes), img)).toBe(true)
  })
})

describe('decodePng color types', () => {
  it('RGB 8-bit', () => {
    const data = new Uint8Array([255, 0, 0, 0, 255, 0, 1, 2, 3])
    const img = decodePng(encode({ width: 3, height: 1, data, channels: 3, depth: 8 }))
    expect(pixels(img)).toEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [1, 2, 3, 255]
    ])
  })

  it('RGBA and RGB 16-bit keep the high byte', () => {
    const rgba = new Uint16Array([0x1234, 0xabcd, 0x00ff, 0xff00, 0xffff, 0x0100, 0x80ff, 0x7f00])
    expect(
      pixels(decodePng(encode({ width: 2, height: 1, data: rgba, channels: 4, depth: 16 })))
    ).toEqual([
      [0x12, 0xab, 0x00, 0xff],
      [0xff, 0x01, 0x80, 0x7f]
    ])
    const rgb = new Uint16Array([0xffff, 0x8000, 0x00ff])
    expect(
      pixels(decodePng(encode({ width: 1, height: 1, data: rgb, channels: 3, depth: 16 })))
    ).toEqual([[0xff, 0x80, 0x00, 0xff]])
  })

  it('grayscale 8-bit and 16-bit', () => {
    const g8 = decodePng(
      encode({ width: 3, height: 1, data: new Uint8Array([0, 128, 255]), channels: 1, depth: 8 })
    )
    expect(pixels(g8)).toEqual([
      [0, 0, 0, 255],
      [128, 128, 128, 255],
      [255, 255, 255, 255]
    ])
    const g16 = decodePng(
      encode({
        width: 2,
        height: 1,
        data: new Uint16Array([0x1fff, 0xfe01]),
        channels: 1,
        depth: 16
      })
    )
    expect(pixels(g16)).toEqual([
      [0x1f, 0x1f, 0x1f, 255],
      [0xfe, 0xfe, 0xfe, 255]
    ])
  })

  it('gray + alpha 8-bit and 16-bit', () => {
    const ga8 = decodePng(
      encode({ width: 2, height: 1, data: new Uint8Array([10, 20, 200, 0]), channels: 2, depth: 8 })
    )
    expect(pixels(ga8)).toEqual([
      [10, 10, 10, 20],
      [200, 200, 200, 0]
    ])
    const ga16 = decodePng(
      encode({
        width: 1,
        height: 1,
        data: new Uint16Array([0x4321, 0x8765]),
        channels: 2,
        depth: 16
      })
    )
    expect(pixels(ga16)).toEqual([[0x43, 0x43, 0x43, 0x87]])
  })

  it('grayscale 1, 2 and 4-bit are scaled to 0-255', () => {
    // 1-bit, width 10 (two bytes per row), rows: 1010000001 / 0111111110
    const g1 = decodePng(
      encode({
        width: 10,
        height: 2,
        data: new Uint8Array([0b10100000, 0b01000000, 0b01111111, 0b10000000]),
        channels: 1,
        depth: 1
      })
    )
    expect(
      pixels(g1)
        .map((p) => (p[0] === 255 ? 1 : 0))
        .join('')
    ).toBe('1010000001' + '0111111110')
    expect(pixels(g1).every((p) => p[0] === p[1] && p[1] === p[2] && p[3] === 255)).toBe(true)
    // 2-bit, width 3: 0, 1, 3 -> 00 01 11 00
    const g2 = decodePng(
      encode({ width: 3, height: 1, data: new Uint8Array([0b00011100]), channels: 1, depth: 2 })
    )
    expect(pixels(g2).map((p) => p[0])).toEqual([0, 85, 255])
    // 4-bit, width 3, two rows: 0, 7, 15 / 15, 1, 8
    const g4 = decodePng(
      encode({
        width: 3,
        height: 2,
        data: new Uint8Array([0x07, 0xf0, 0xf1, 0x80]),
        channels: 1,
        depth: 4
      })
    )
    expect(pixels(g4).map((p) => p[0])).toEqual([0, 119, 255, 255, 17, 136])
  })

  it('indexed 8-bit with tRNS transparency', () => {
    const palette = [
      [0, 0, 0, 0],
      [255, 0, 0, 128],
      [0, 255, 0, 255],
      [10, 20, 30, 255]
    ]
    const data = new Uint8Array([3, 2, 1, 0, 2, 2])
    const img = decodePng(encode({ width: 3, height: 2, data, channels: 1, depth: 8, palette }))
    expect(pixels(img)).toEqual([
      [10, 20, 30, 255],
      [0, 255, 0, 255],
      [255, 0, 0, 128],
      [0, 0, 0, 0],
      [0, 255, 0, 255],
      [0, 255, 0, 255]
    ])
  })

  it('indexed 1, 2 and 4-bit without tRNS', () => {
    const palette = [
      [1, 2, 3],
      [40, 50, 60],
      [70, 80, 90],
      [100, 110, 120]
    ]
    const p1 = decodePng(
      encode({
        width: 3,
        height: 1,
        data: new Uint8Array([0b01000000]),
        channels: 1,
        depth: 1,
        palette: palette.slice(0, 2)
      })
    )
    expect(pixels(p1)).toEqual([
      [1, 2, 3, 255],
      [40, 50, 60, 255],
      [1, 2, 3, 255]
    ])
    const p2 = decodePng(
      encode({
        width: 4,
        height: 1,
        data: new Uint8Array([0b11100100]),
        channels: 1,
        depth: 2,
        palette
      })
    )
    expect(pixels(p2).map((p) => p[0])).toEqual([100, 70, 40, 1])
    const p4 = decodePng(
      encode({
        width: 3,
        height: 1,
        data: new Uint8Array([0x32, 0x00]),
        channels: 1,
        depth: 4,
        palette
      })
    )
    expect(pixels(p4).map((p) => p[0])).toEqual([100, 70, 1])
  })

  it('decodes an out-of-range palette index as opaque black', () => {
    const palette = [
      [9, 9, 9],
      [8, 8, 8]
    ]
    const img = decodePng(
      encode({
        width: 2,
        height: 1,
        data: new Uint8Array([0b01110000]),
        channels: 1,
        depth: 2,
        palette
      })
    )
    expect(pixels(img)).toEqual([
      [8, 8, 8, 255],
      [0, 0, 0, 255]
    ])
  })

  it('grayscale tRNS makes the key gray transparent', () => {
    const base = encode({
      width: 3,
      height: 1,
      data: new Uint8Array([64, 65, 64]),
      channels: 1,
      depth: 8
    })
    const img = decodePng(insertAfterIhdr(base, chunk('tRNS', [0x00, 0x40])))
    expect(pixels(img)).toEqual([
      [64, 64, 64, 0],
      [65, 65, 65, 255],
      [64, 64, 64, 0]
    ])
  })

  it('low-bit grayscale tRNS compares the raw sample', () => {
    const base = encode({
      width: 3,
      height: 1,
      data: new Uint8Array([0b01101100]),
      channels: 1,
      depth: 2
    })
    const img = decodePng(insertAfterIhdr(base, chunk('tRNS', [0x00, 0x02])))
    expect(pixels(img)).toEqual([
      [85, 85, 85, 255],
      [170, 170, 170, 0],
      [255, 255, 255, 255]
    ])
  })

  it('RGB 16-bit tRNS compares the full 16-bit sample', () => {
    // 2x2: fast-png 8 rejects an RGB tRNS chunk on images with fewer than 3 pixels.
    const data = new Uint16Array([
      0x1234, 0x0000, 0xffff, 0x12ff, 0x0000, 0xffff, 0x1234, 0x0001, 0xffff, 0x1234, 0x0000, 0xffff
    ])
    const base = encode({ width: 2, height: 2, data, channels: 3, depth: 16 })
    const img = decodePng(
      insertAfterIhdr(base, chunk('tRNS', [0x12, 0x34, 0x00, 0x00, 0xff, 0xff]))
    )
    expect(pixels(img)).toEqual([
      [0x12, 0x00, 0xff, 0],
      [0x12, 0x00, 0xff, 255],
      [0x12, 0x00, 0xff, 255],
      [0x12, 0x00, 0xff, 0]
    ])
  })

  it('RGB 8-bit tRNS', () => {
    const data = new Uint8Array([1, 2, 3, 1, 2, 4, 0, 2, 3, 1, 2, 3])
    const base = encode({ width: 4, height: 1, data, channels: 3, depth: 8 })
    const img = decodePng(insertAfterIhdr(base, chunk('tRNS', [0, 1, 0, 2, 0, 3])))
    expect(pixels(img)).toEqual([
      [1, 2, 3, 0],
      [1, 2, 4, 255],
      [0, 2, 3, 255],
      [1, 2, 3, 0]
    ])
  })

  it('refuses interlaced low-bit images (fast-png 8 cannot de-interlace them correctly)', () => {
    const base = encode({
      width: 3,
      height: 1,
      data: new Uint8Array([0b01101100]),
      channels: 1,
      depth: 2
    })
    const ihdr = [...base.subarray(16, 29)]
    ihdr[12] = 1 // interlace method: Adam7
    const patched = new Uint8Array(base)
    patched.set(chunk('IHDR', ihdr), 8)
    expect(() => decodePng(patched)).toThrow()
  })
})
