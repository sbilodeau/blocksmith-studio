import { describe, expect, it, vi } from 'vitest'
import { createImage, getPixel, setPixel } from '@shared/image'
import { makeGif } from '../fixtures/gif'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { decodeGif, fitInto, gifToStrip } = await import('../../src/main/services/packs/gif')

const RED: [number, number, number] = [255, 0, 0]
const BLUE: [number, number, number] = [0, 0, 255]

describe('decodeGif', () => {
  it('reads every frame with its delay', () => {
    const gif = decodeGif(makeGif(4, 4, [RED, BLUE], [5, 20]))
    expect([gif.width, gif.height, gif.frames.length]).toEqual([4, 4, 2])
    expect(gif.delaysMs).toEqual([50, 200])
    expect(getPixel(gif.frames[0]!, 3, 3)).toEqual([255, 0, 0, 255])
    expect(getPixel(gif.frames[1]!, 3, 3)).toEqual([0, 0, 255, 255])
  })

  it('composes partial frames over the previous one, following the disposal method', () => {
    // Disposal 1 (keep): frame 2 covers its top-left quarter, the rest stays red.
    const keep = decodeGif(makeGif(4, 4, [RED, BLUE], [10, 10], { partial: true }))
    expect(getPixel(keep.frames[1]!, 0, 0)).toEqual([0, 0, 255, 255])
    expect(getPixel(keep.frames[1]!, 3, 3)).toEqual([255, 0, 0, 255])
    // Disposal 2 (background): the previous frame's area is cleared before the next one.
    const clear = decodeGif(makeGif(4, 4, [RED, BLUE], [10, 10], { partial: true, disposal: 2 }))
    expect(getPixel(clear.frames[1]!, 3, 3)).toEqual([0, 0, 0, 0])
    expect(getPixel(clear.frames[1]!, 0, 0)).toEqual([0, 0, 255, 255])
  })

  it('refuses files that are not GIFs', () => {
    expect(() => decodeGif(new TextEncoder().encode('GIF89a nope'))).toThrow()
    expect(() => decodeGif(new Uint8Array())).toThrow()
  })
})

describe('fitting frames to the texture', () => {
  it('keeps the aspect ratio and centers on transparency', () => {
    const wide = createImage(4, 2, [255, 0, 0, 255])
    setPixel(wide, 3, 1, [0, 255, 0, 255])
    const out = fitInto(wide, 8, 8)
    expect([out.width, out.height]).toEqual([8, 8])
    expect(getPixel(out, 0, 0)).toEqual([0, 0, 0, 0])
    expect(getPixel(out, 0, 2)).toEqual([255, 0, 0, 255])
    expect(getPixel(out, 7, 5)).toEqual([0, 255, 0, 255])
    expect(getPixel(out, 7, 6)).toEqual([0, 0, 0, 0])
  })

  it('drops frames past the largest texture height', () => {
    const gif = decodeGif(makeGif(2, 2, [RED, BLUE, RED], [1, 1, 1]))
    const strip = gifToStrip(gif, 2048, 2048)
    expect(strip).toMatchObject({ frames: 2, truncated: true, delaysMs: [10, 10] })
  })
})
