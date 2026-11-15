import { describe, expect, it } from 'vitest'
import { createImage } from '@shared/image'
import { frameAt, parseAnimation } from '../../src/renderer/components/preview3d/animation'

const strip = createImage(16, 64) // 4 frames of 16x16

describe('texture animation (.png.mcmeta)', () => {
  it('returns null for non-animated textures', () => {
    expect(parseAnimation(null, strip)).toBeNull()
    expect(parseAnimation('{"texture":{}}', strip)).toBeNull()
    expect(parseAnimation('not json', strip)).toBeNull()
  })

  it('defaults to every frame in order with frametime 1 tick (50 ms)', () => {
    const a = parseAnimation('{"animation":{}}', strip)!
    expect(a.frameHeight).toBe(16)
    expect(a.sequence).toEqual([
      [0, 50],
      [1, 50],
      [2, 50],
      [3, 50]
    ])
    expect(frameAt(a, 0)).toBe(0)
    expect(frameAt(a, 120)).toBe(2)
    expect(frameAt(a, 210)).toBe(0) // loops
  })

  it('supports frametime and explicit frames with per-frame time', () => {
    const a = parseAnimation(
      '{"animation":{"frametime":2,"frames":[3,{"index":1,"time":5}]}}',
      strip
    )!
    expect(a.sequence).toEqual([
      [3, 100],
      [1, 250]
    ])
    expect(frameAt(a, 99)).toBe(3)
    expect(frameAt(a, 100)).toBe(1)
  })
})
