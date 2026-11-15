import { describe, expect, it } from 'vitest'
import {
  ModelResolveError,
  bakeElements,
  defaultFaceUv,
  normalizeResourceId,
  parseElement,
  resolveModel,
  resolveTextureVariable,
  textureIdToPath
} from '../../src/main/services/preview/models'

const CUBE = {
  parent: 'block/block',
  elements: [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: {
        down: { texture: '#down', cullface: 'down' },
        up: { texture: '#up', cullface: 'up' },
        north: { texture: '#north', cullface: 'north' },
        south: { texture: '#south', cullface: 'south' },
        west: { texture: '#west', cullface: 'west' },
        east: { texture: '#east', cullface: 'east' }
      }
    }
  ]
}

const MODELS: Record<string, unknown> = {
  'minecraft:block/block': { display: {} },
  'minecraft:block/cube': CUBE,
  'minecraft:block/cube_all': {
    parent: 'block/cube',
    textures: {
      particle: '#all',
      down: '#all',
      up: '#all',
      north: '#all',
      east: '#all',
      south: '#all',
      west: '#all'
    }
  },
  'minecraft:block/stone': { parent: 'minecraft:block/cube_all', textures: { all: 'block/stone' } },
  'minecraft:block/cube_column': {
    parent: 'block/cube',
    textures: {
      particle: '#side',
      down: '#end',
      up: '#end',
      north: '#side',
      east: '#side',
      south: '#side',
      west: '#side'
    }
  },
  'minecraft:block/oak_log': {
    parent: 'block/cube_column',
    textures: { end: 'block/oak_log_top', side: 'block/oak_log' }
  },
  'minecraft:block/a': { parent: 'block/b' },
  'minecraft:block/b': { parent: 'block/a' },
  'minecraft:block/orphan': { parent: 'block/missing', textures: { all: 'block/stone' } },
  'minecraft:block/invalid': null,
  'minecraft:item/generated_child': {
    parent: 'builtin/generated',
    textures: { layer0: 'item/apple' }
  }
}
const lookup = (id: string): unknown => MODELS[id]

describe('resource ids and paths', () => {
  it('adds the minecraft namespace when missing', () => {
    expect(normalizeResourceId('block/stone')).toBe('minecraft:block/stone')
    expect(normalizeResourceId('mymod:block/x')).toBe('mymod:block/x')
  })

  it('maps texture ids to pack paths', () => {
    expect(textureIdToPath('block/stone')).toBe('assets/minecraft/textures/block/stone.png')
    expect(textureIdToPath('minecraft:block/stone')).toBe(
      'assets/minecraft/textures/block/stone.png'
    )
    expect(textureIdToPath('mymod:block/sub/ore')).toBe('assets/mymod/textures/block/sub/ore.png')
  })

  it('rejects unsafe or invalid texture ids', () => {
    expect(textureIdToPath('block/../../x')).toBeNull()
    expect(textureIdToPath('block/Stone')).toBeNull()
    expect(textureIdToPath('block//stone')).toBeNull()
    expect(textureIdToPath('bad ns:block/stone')).toBeNull()
  })
})

describe('defaultFaceUv', () => {
  const from: [number, number, number] = [2, 3, 4]
  const to: [number, number, number] = [10, 12, 14]
  it.each([
    ['down', [2, 2, 10, 12]],
    ['up', [2, 4, 10, 14]],
    ['north', [6, 4, 14, 13]],
    ['south', [2, 4, 10, 13]],
    ['west', [4, 4, 14, 13]],
    ['east', [2, 4, 12, 13]]
  ] as const)('%s', (face, uv) => {
    expect(defaultFaceUv(face, from, to)).toEqual(uv)
  })

  it('rounds float noise', () => {
    expect(defaultFaceUv('east', [8, 0, 0.8], [8, 16, 15.2])).toEqual([0.8, 0, 15.2, 16])
  })

  it('is the full texture for a full cube', () => {
    for (const face of ['down', 'up', 'north', 'south', 'west', 'east'] as const) {
      expect(defaultFaceUv(face, [0, 0, 0], [16, 16, 16])).toEqual([0, 0, 16, 16])
    }
  })
})

describe('parseElement', () => {
  it('keeps rotation, shade, face uv/rotation/tintindex and fills default uvs', () => {
    const element = parseElement({
      from: [0.8, 0, 8],
      to: [15.2, 16, 8],
      rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
      shade: false,
      faces: {
        north: { uv: [0, 0, 16, 16], texture: '#cross', rotation: 90, tintindex: 0 },
        south: { texture: 'cross', cullface: 'south' },
        up: { uv: [0, 0, 16, 16] }
      }
    })
    expect(element).toEqual({
      from: [0.8, 0, 8],
      to: [15.2, 16, 8],
      rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
      shade: false,
      faces: {
        north: { texture: 'cross', uv: [0, 0, 16, 16], rotation: 90, tintindex: 0 },
        south: { texture: 'cross', uv: [0.8, 0, 15.2, 16] }
      }
    })
  })

  it('drops invalid values and malformed elements', () => {
    expect(parseElement({ from: [0, 0], to: [16, 16, 16] })).toBeNull()
    expect(parseElement('x')).toBeNull()
    const element = parseElement({
      from: [0, 0, 0],
      to: [16, 16, 16],
      rotation: { axis: 'w', angle: 45 },
      faces: { up: { texture: '#a', rotation: 45, tintindex: -1, uv: [0, 0, 16] } }
    })
    expect(element).toEqual({
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: { up: { texture: 'a', uv: [0, 0, 16, 16] } }
    })
  })

  it('defaults the rotation origin to the block center', () => {
    expect(
      parseElement({ from: [0, 0, 0], to: [1, 1, 1], rotation: { axis: 'x', angle: 22.5 } })
    ).toMatchObject({ rotation: { origin: [8, 8, 8], axis: 'x', angle: 22.5 } })
  })
})

describe('resolveModel', () => {
  it('follows the parent chain: textures merge (child wins), elements come from the nearest model', () => {
    const model = resolveModel('block/oak_log', lookup)
    expect(model.id).toBe('minecraft:block/oak_log')
    expect(model.textures).toEqual({
      particle: '#side',
      down: '#end',
      up: '#end',
      north: '#side',
      east: '#side',
      south: '#side',
      west: '#side',
      end: 'block/oak_log_top',
      side: 'block/oak_log'
    })
    expect(model.elements).toHaveLength(1)
    expect(model.elements[0].faces.up).toEqual({ texture: 'up', uv: [0, 0, 16, 16] })
  })

  it('replaces parent elements with the child ones', () => {
    const own = { from: [0, 0, 0], to: [16, 8, 16], faces: { up: { texture: '#top' } } }
    const model = resolveModel('block/slab', (id) =>
      id === 'minecraft:block/slab' ? { parent: 'block/cube_all', elements: [own] } : lookup(id)
    )
    expect(model.elements).toEqual([
      { from: [0, 0, 0], to: [16, 8, 16], faces: { up: { texture: 'top', uv: [0, 0, 16, 16] } } }
    ])
    expect(model.textures['all']).toBeUndefined()
    expect(model.textures['up']).toBe('#all')
  })

  it('stops at builtin parents with no elements', () => {
    const model = resolveModel('item/generated_child', lookup)
    expect(model.elements).toEqual([])
    expect(model.textures).toEqual({ layer0: 'item/apple' })
  })

  it('throws ModelResolveError for cycles, missing parents and invalid JSON', () => {
    expect(() => resolveModel('block/a', lookup)).toThrow(ModelResolveError)
    expect(() => resolveModel('block/orphan', lookup)).toThrow(/block\/missing not found/)
    expect(() => resolveModel('block/invalid', lookup)).toThrow(/not valid JSON/)
    expect(() => resolveModel('block/nope', lookup)).toThrow(ModelResolveError)
  })

  it('memoizes results and failures across calls', () => {
    const memo = new Map()
    let reads = 0
    const counting = (id: string): unknown => {
      reads++
      return lookup(id)
    }
    resolveModel('block/stone', counting, memo)
    const first = reads
    resolveModel('block/oak_log', counting, memo)
    expect(reads - first).toBe(2) // oak_log + cube_column; cube and block are memoized
    expect(() => resolveModel('block/a', counting, memo)).toThrow()
    const afterCycle = reads
    expect(() => resolveModel('block/b', counting, memo)).toThrow()
    expect(reads).toBe(afterCycle)
  })
})

describe('texture variables', () => {
  it('resolves #ref chains', () => {
    const textures = { up: '#end', end: '#top', top: 'block/oak_log_top' }
    expect(resolveTextureVariable('up', textures)).toBe('block/oak_log_top')
    expect(resolveTextureVariable('top', textures)).toBe('block/oak_log_top')
  })

  it('returns null for undefined variables and cycles', () => {
    expect(resolveTextureVariable('missing', {})).toBeNull()
    expect(resolveTextureVariable('a', { a: '#b', b: '#c', c: '#a' })).toBeNull()
    expect(resolveTextureVariable('a', { a: '#a' })).toBeNull()
  })

  it('bakes faces to pack paths and drops unresolved faces', () => {
    const stone = bakeElements(resolveModel('block/stone', lookup))
    expect(stone).toHaveLength(1)
    expect(Object.keys(stone[0].faces).sort()).toEqual([
      'down',
      'east',
      'north',
      'south',
      'up',
      'west'
    ])
    expect(stone[0].faces.north).toEqual({
      texture: 'assets/minecraft/textures/block/stone.png',
      uv: [0, 0, 16, 16]
    })
    // The template itself has no texture values: nothing to render.
    expect(bakeElements(resolveModel('block/cube_all', lookup))).toEqual([])
  })

  it('accepts 1.21.6+ texture objects ({ sprite })', () => {
    const model = resolveModel('block/x', (id) =>
      id === 'minecraft:block/x'
        ? {
            parent: 'block/cube_all',
            textures: { all: { sprite: 'block/glass', force_translucent: true } }
          }
        : lookup(id)
    )
    expect(bakeElements(model)[0].faces.up?.texture).toBe(
      'assets/minecraft/textures/block/glass.png'
    )
  })
})
