import { describe, expect, it } from 'vitest'
import type { BlockPreview, EntityPreview } from '@shared/model/preview'
import { MAX_LAYOUT_CUBES, describeModelLayout } from '@shared/preview/layout'

const ENTITY_PATH = 'assets/minecraft/textures/entity/test.png'
const BLOCK_PATH = 'assets/minecraft/textures/block/test.png'

function entity(overrides: Partial<EntityPreview['definition']> = {}): EntityPreview {
  return {
    kind: 'entity',
    source: 'jar',
    definition: {
      id: 'test',
      textureSize: [64, 32],
      textures: [ENTITY_PATH],
      parts: [
        {
          name: 'head',
          pivot: [0, 24, 0],
          boxes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }],
          children: [
            {
              name: 'fin',
              pivot: [0, 32, 0],
              rotation: [0, 0, 45],
              boxes: [{ origin: [0, 32, 0], size: [0, 4, 3], uv: [32, 0], mirror: true }]
            }
          ]
        }
      ],
      ...overrides
    }
  }
}

describe('describeModelLayout', () => {
  it('lists every cube face of an entity as a texture rectangle', () => {
    const text = describeModelLayout(entity(), ENTITY_PATH, 64, 32)!
    expect(text).toContain('exact model read from the Minecraft jar')
    expect(text).toContain(
      '- head (cube 8x8x8): top 8,0 8x8 | bottom 16,0 8x8 | right 0,8 8x8 | front 8,8 8x8 | left 16,8 8x8 | back 24,8 8x8'
    )
    // Zero-width faces of a flat plane are skipped; mirrored boxes are flagged and normalized.
    expect(text).toContain(
      '- head > fin (cube 0x4x3, mirrored, part rotated 0°/0°/45° (x/y/z)): right 35,3 3x4 | left 32,3 3x4'
    )
    expect(text).not.toContain('front 35')
  })

  it('scales the rectangles to high-resolution textures and rejects other layouts', () => {
    const text = describeModelLayout(entity(), ENTITY_PATH, 128, 64)!
    expect(text).toContain('scaled x2')
    expect(text).toContain('front 16,16 16x16')
    expect(describeModelLayout(entity(), ENTITY_PATH, 64, 64)).toBeUndefined()
  })

  it('names built-in models as approximations and caps big models', () => {
    const many = Array.from({ length: MAX_LAYOUT_CUBES + 5 }, (_, i) => ({
      name: `p${i}`,
      pivot: [0, 0, 0] as [number, number, number],
      boxes: [
        {
          origin: [0, 0, 0] as [number, number, number],
          size: [1, 1, 1] as [number, number, number],
          uv: [0, 0] as [number, number]
        }
      ]
    }))
    const model = { ...entity({ parts: many }), source: 'builtin' as const }
    const text = describeModelLayout(model, ENTITY_PATH, 64, 32)!
    expect(text).toContain('built-in approximation')
    expect(text).toContain('- ... 5 more cube(s) not listed')
  })

  it('groups block faces by texture rectangle, per animation frame', () => {
    const block: BlockPreview = {
      kind: 'block',
      modelId: 'minecraft:block/test',
      tints: { 0: '#7fb238' },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: {
            up: { texture: BLOCK_PATH, uv: [0, 0, 16, 16], tintindex: 0 },
            north: { texture: BLOCK_PATH, uv: [0, 0, 16, 16] },
            south: { texture: BLOCK_PATH, uv: [0, 0, 16, 16] },
            east: { texture: 'assets/minecraft/textures/block/other.png', uv: [0, 0, 16, 16] },
            down: { texture: BLOCK_PATH, uv: [0, 8, 16, 16], rotation: 90 }
          }
        }
      ]
    }
    const text = describeModelLayout(block, BLOCK_PATH, 16, 32)!
    expect(text).toContain('minecraft:block/test')
    expect(text).toContain('within one animation frame')
    expect(text).toContain('- 0,0 16x16 (tinted): up')
    expect(text).toContain('- 0,0 16x16: north, south')
    expect(text).toContain('- 0,8 16x8 (rotated 90°): down')
    expect(text).not.toMatch(/^- .*east/m)
  })

  it('describes items briefly and says nothing for flat textures', () => {
    expect(describeModelLayout({ kind: 'item' }, 'x.png', 16, 16)).toContain('flat sprite')
    expect(describeModelLayout({ kind: 'flat' }, 'x.png', 16, 16)).toBeUndefined()
    expect(describeModelLayout(null, 'x.png', 16, 16)).toBeUndefined()
  })
})
