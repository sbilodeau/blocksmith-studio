import { describe, expect, it } from 'vitest'
import { boxUvExtent, boxUvRects } from '@shared/preview/box-uv'

describe('box UV layout', () => {
  // Classic head: 8x8x8 at (0, 0) -> the standard skin layout.
  const head = { size: [8, 8, 8] as [number, number, number], uv: [0, 0] as [number, number] }

  it('matches the standard skin head layout', () => {
    const r = boxUvRects(head)
    expect(r.top).toEqual({ u1: 8, v1: 0, u2: 16, v2: 8 })
    expect(r.bottom).toEqual({ u1: 16, v1: 8, u2: 24, v2: 0 })
    expect(r.right).toEqual({ u1: 0, v1: 8, u2: 8, v2: 16 })
    expect(r.front).toEqual({ u1: 8, v1: 8, u2: 16, v2: 16 })
    expect(r.left).toEqual({ u1: 16, v1: 8, u2: 24, v2: 16 })
    expect(r.back).toEqual({ u1: 24, v1: 8, u2: 32, v2: 16 })
  })

  it('handles non-cubic boxes (body 8x12x4 at 16,16)', () => {
    const r = boxUvRects({ size: [8, 12, 4], uv: [16, 16] })
    expect(r.front).toEqual({ u1: 20, v1: 20, u2: 28, v2: 32 })
    expect(r.back).toEqual({ u1: 32, v1: 20, u2: 40, v2: 32 })
    expect(boxUvExtent({ size: [8, 12, 4], uv: [16, 16] })).toEqual({
      u1: 16,
      v1: 16,
      u2: 40,
      v2: 32
    })
  })

  it('mirrors by swapping side strips and flipping horizontally', () => {
    const r = boxUvRects({ size: [4, 12, 4], uv: [40, 16], mirror: true })
    expect(r.right).toEqual({ u1: 52, v1: 20, u2: 48, v2: 32 })
    expect(r.left).toEqual({ u1: 44, v1: 20, u2: 40, v2: 32 })
    expect(r.front).toEqual({ u1: 48, v1: 20, u2: 44, v2: 32 })
  })
})
