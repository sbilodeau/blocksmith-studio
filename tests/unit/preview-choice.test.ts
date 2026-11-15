import { describe, expect, it } from 'vitest'
import {
  FALLBACK_MODEL_ID,
  blockPreviewFor,
  buildBlockIndex,
  chooseBlockModel,
  fallbackCube,
  namePrefixes,
  type ModelFiles
} from '../../src/main/services/preview/block-index'
import { blockstateModels } from '../../src/main/services/preview/blockstates'
import { previewCategory } from '../../src/main/services/preview/category'

const T = (name: string): string => `assets/minecraft/textures/block/${name}.png`

const cubeFaces = (texture: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  Object.fromEntries(
    ['down', 'up', 'north', 'south', 'west', 'east'].map((f) => [f, { texture, ...extra }])
  )

function files(
  models: Record<string, unknown>,
  blockstates: Record<string, unknown> = {}
): ModelFiles {
  const ns = (id: string): string => (id.includes(':') ? id : `minecraft:${id}`)
  return {
    models: new Map(Object.entries(models).map(([k, v]) => [ns(k), v])),
    blockstates: new Map(Object.entries(blockstates).map(([k, v]) => [ns(k), v]))
  }
}

const cube = (texture: string, count = 1): unknown => ({
  textures: { t: texture },
  elements: Array.from({ length: count }, () => ({
    from: [0, 0, 0],
    to: [16, 16, 16],
    faces: cubeFaces('#t')
  }))
})

describe('previewCategory', () => {
  it.each([
    ['assets/minecraft/textures/entity/zombie/zombie.png', 'entity'],
    ['assets/minecraft/textures/item/apple.png', 'item'],
    ['assets/minecraft/textures/block/stone.png', 'block'],
    ['assets/mymod/textures/block/ore.png', 'block'],
    ['assets/minecraft/textures/gui/sprites/hud/heart/full.png', 'flat'],
    ['assets/minecraft/textures/particle/flame.png', 'flat'],
    ['assets/minecraft/textures/painting/kebab.png', 'flat'],
    ['assets/minecraft/textures/blocks/old.png', 'flat']
  ])('%s -> %s', (path, kind) => {
    expect(previewCategory(path)).toBe(kind)
  })
})

describe('blockstateModels', () => {
  it('flattens variants and weighted arrays in file order and flags rotations', () => {
    expect(
      blockstateModels({
        variants: {
          'axis=x': { model: 'minecraft:block/oak_log_horizontal', x: 90, y: 90 },
          'axis=y': { model: 'block/oak_log' },
          'axis=z': [{ model: 'block/a', y: 360 }, { model: 'block/b', y: 180 }, { nope: 1 }]
        }
      })
    ).toEqual([
      { model: 'minecraft:block/oak_log_horizontal', rotated: true },
      { model: 'minecraft:block/oak_log', rotated: false },
      { model: 'minecraft:block/a', rotated: false },
      { model: 'minecraft:block/b', rotated: true }
    ])
  })

  it('reads multipart apply entries and ignores invalid content', () => {
    expect(
      blockstateModels({
        multipart: [
          { apply: { model: 'block/post' } },
          { when: {}, apply: [{ model: 'block/side' }] },
          4
        ]
      })
    ).toEqual([
      { model: 'minecraft:block/post', rotated: false },
      { model: 'minecraft:block/side', rotated: false }
    ])
    expect(blockstateModels(null)).toEqual([])
    expect(blockstateModels({ variants: 3 })).toEqual([])
  })
})

describe('buildBlockIndex', () => {
  it('maps textures to the models that render them, skipping item models and broken ones', () => {
    const index = buildBlockIndex(
      files({
        'block/stone': cube('block/stone'),
        'block/stone_slab': cube('block/stone'),
        'item/stone_thing': cube('block/stone'),
        'block/template': {
          elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: cubeFaces('#x') }]
        },
        'block/broken': { parent: 'block/nowhere' },
        'block/invalid': null
      })
    )
    expect(index.byTexture.get(T('stone'))).toEqual([
      'minecraft:block/stone',
      'minecraft:block/stone_slab'
    ])
    expect([...index.models.keys()].sort()).toEqual([
      'minecraft:block/stone',
      'minecraft:block/stone_slab'
    ])
    expect(index.broken.map((b) => b.id).sort()).toEqual([
      'minecraft:block/broken',
      'minecraft:block/invalid'
    ])
  })
})

describe('chooseBlockModel', () => {
  it('lists the texture name and its prefixes, longest first', () => {
    expect(namePrefixes('grass_block_top')).toEqual(['grass_block_top', 'grass_block', 'grass'])
    expect(namePrefixes('stone')).toEqual(['stone'])
  })

  it('prefers a model of the blockstate named like the texture (or a prefix), unrotated first', () => {
    const index = buildBlockIndex(
      files(
        {
          'block/oak_log': cube('block/oak_log_top'),
          'block/oak_log_horizontal': cube('block/oak_log_top'),
          'block/oak_log_top': cube('block/oak_log_top', 3),
          'block/stripped_thing': cube('block/oak_log_top')
        },
        {
          oak_log: {
            variants: {
              'axis=x': { model: 'block/oak_log_horizontal', x: 90, y: 90 },
              'axis=y': { model: 'block/oak_log' }
            }
          }
        }
      )
    )
    expect(chooseBlockModel(index, T('oak_log_top'))).toEqual({
      modelId: 'minecraft:block/oak_log',
      blockName: 'oak_log',
      rule: 'blockstate'
    })
  })

  it('takes a rotated variant when it is the only one using the texture', () => {
    const index = buildBlockIndex(
      files(
        { 'block/thing_side': cube('block/thing_front'), 'block/other': cube('block/thing_front') },
        { thing: { variants: { 'facing=east': { model: 'block/thing_side', y: 90 } } } }
      )
    )
    expect(chooseBlockModel(index, T('thing_front'))?.modelId).toBe('minecraft:block/thing_side')
  })

  it('skips blockstates whose models do not use the texture', () => {
    const index = buildBlockIndex(
      files(
        {
          'block/grass': cube('block/grass'),
          'block/grass_block_top': cube('block/grass_block_top')
        },
        { grass: { variants: { '': { model: 'block/grass' } } } }
      )
    )
    expect(chooseBlockModel(index, T('grass_block_top'))).toEqual({
      modelId: 'minecraft:block/grass_block_top',
      blockName: 'grass_block_top',
      rule: 'name'
    })
  })

  it('then takes the model named block/<texture>, then the fewest elements', () => {
    const named = buildBlockIndex(
      files({ 'block/ore': cube('block/ore', 2), 'block/a': cube('block/ore') })
    )
    expect(chooseBlockModel(named, T('ore'))?.rule).toBe('name')
    const fewest = buildBlockIndex(
      files({
        'block/zz': cube('block/tex'),
        'block/aa': cube('block/tex'),
        'block/b': cube('block/tex', 2),
        'block/long_name': cube('block/tex')
      })
    )
    expect(chooseBlockModel(fewest, T('tex'))).toEqual({
      modelId: 'minecraft:block/aa',
      blockName: 'aa',
      rule: 'fewestElements'
    })
  })

  it('returns null when no model uses the texture', () => {
    const index = buildBlockIndex(files({ 'block/stone': cube('block/stone') }))
    expect(chooseBlockModel(index, T('dirt'))).toBeNull()
  })
})

describe('block previews', () => {
  it('builds the fallback cube, tinted for known tinted textures', () => {
    expect(fallbackCube(T('dirt'))).toEqual({
      kind: 'block',
      modelId: FALLBACK_MODEL_ID,
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: Object.fromEntries(
            ['north', 'south', 'east', 'west', 'up', 'down'].map((f) => [
              f,
              { texture: T('dirt'), uv: [0, 0, 16, 16] }
            ])
          )
        }
      ],
      tints: {}
    })
    const water = fallbackCube(T('water_flow'))
    expect(water.tints).toEqual({ 0: '#3f76e4' })
    expect(water.elements[0].faces.up?.tintindex).toBe(0)
    expect(fallbackCube(T('cherry_leaves')).tints).toEqual({})
  })

  it('adds a default tint for every tintindex of the chosen model', () => {
    const index = buildBlockIndex(
      files(
        {
          'block/grass_block': {
            textures: { top: 'block/grass_block_top' },
            elements: [
              {
                from: [0, 0, 0],
                to: [16, 16, 16],
                faces: { up: { texture: '#top', tintindex: 0 } }
              },
              {
                from: [0, 0, 0],
                to: [16, 16, 16],
                faces: { down: { texture: '#top', tintindex: 2 } }
              }
            ]
          }
        },
        { grass_block: { variants: { '': { model: 'block/grass_block' } } } }
      )
    )
    const preview = blockPreviewFor(index, T('grass_block_top'))
    expect(preview.modelId).toBe('minecraft:block/grass_block')
    expect(preview.tints).toEqual({ 0: '#91bd59', 2: '#91bd59' })
    // The index is not shared with the result.
    preview.elements[0].from[0] = 99
    expect(blockPreviewFor(index, T('grass_block_top')).elements[0].from[0]).toBe(0)
  })
})
