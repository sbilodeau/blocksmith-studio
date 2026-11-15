import { describe, expect, it } from 'vitest'
import { encode } from 'fast-png'
import { readPngSize } from '../../src/main/services/vanilla/png'

function png(width: number, height: number): Uint8Array {
  return encode({ width, height, data: new Uint8Array(width * height * 4), channels: 4, depth: 8 })
}

describe('readPngSize', () => {
  it.each([
    [16, 16],
    [16, 512],
    [64, 32],
    [1, 1],
    [300, 7]
  ])('reads %ix%i from the IHDR chunk', (width, height) => {
    expect(readPngSize(png(width, height))).toEqual({ width, height })
  })

  it('only needs the first 24 bytes', () => {
    expect(readPngSize(png(48, 96).slice(0, 24))).toEqual({ width: 48, height: 96 })
  })

  it('works on a subarray with a byte offset', () => {
    const bytes = png(20, 40)
    const padded = new Uint8Array(bytes.length + 10)
    padded.set(bytes, 10)
    expect(readPngSize(padded.subarray(10))).toEqual({ width: 20, height: 40 })
  })

  it('rejects non-PNG data, truncated headers and a missing IHDR', () => {
    expect(readPngSize(new Uint8Array(0))).toBeNull()
    expect(readPngSize(new TextEncoder().encode('{"not":"a png at all, clearly"}'))).toBeNull()
    expect(readPngSize(png(16, 16).slice(0, 20))).toBeNull()
    const broken = png(16, 16)
    broken[12] = 0x58 // "XHDR"
    expect(readPngSize(broken)).toBeNull()
    const wrongSignature = png(16, 16)
    wrongSignature[1] = 0
    expect(readPngSize(wrongSignature)).toBeNull()
  })

  it('rejects a zero dimension', () => {
    const bytes = png(16, 16)
    new DataView(bytes.buffer).setUint32(16, 0)
    expect(readPngSize(bytes)).toBeNull()
  })
})
