import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockElement, EntityDefinition, FaceName } from '@shared/model/preview'
import { T, createTestEnv, json, vanillaFiles, type TestEnv } from './packs-fixtures'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createPreviewService, FALLBACK_MODEL_ID } = await import('../../src/main/services/preview')
const { AppErrorException } = await import('../../src/main/ipc/registry')

const M = (id: string): string => `assets/minecraft/models/block/${id}.json`
const BS = (id: string): string => `assets/minecraft/blockstates/${id}.json`
const FULL: [number, number, number, number] = [0, 0, 16, 16]
const ALL_FACES: FaceName[] = ['north', 'south', 'east', 'west', 'up', 'down']

/** Hand-written models in the shape of vanilla's (no Mojang file is copied). */
function vanillaModels(): Record<string, Uint8Array> {
  const cubeFace = (name: string): Record<string, string> => ({
    texture: `#${name}`,
    cullface: name
  })
  return {
    [M('block')]: json({ display: {} }),
    [M('cube')]: json({
      parent: 'block/block',
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: Object.fromEntries(ALL_FACES.map((f) => [f, cubeFace(f)]))
        }
      ]
    }),
    [M('cube_all')]: json({
      parent: 'block/cube',
      textures: Object.fromEntries([['particle', '#all'], ...ALL_FACES.map((f) => [f, '#all'])])
    }),
    [M('cube_column')]: json({
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
    }),
    [M('stone')]: json({ parent: 'minecraft:block/cube_all', textures: { all: 'block/stone' } }),
    [BS('stone')]: json({ variants: { '': { model: 'minecraft:block/stone' } } }),
    [M('grass_block')]: json({
      parent: 'block/block',
      textures: {
        particle: 'block/dirt',
        bottom: 'block/dirt',
        top: 'block/grass_block_top',
        side: 'block/grass_block_side',
        overlay: 'block/grass_block_side_overlay'
      },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: {
            down: { uv: FULL, texture: '#bottom', cullface: 'down' },
            up: { uv: FULL, texture: '#top', cullface: 'up', tintindex: 0 },
            north: { uv: FULL, texture: '#side', cullface: 'north' },
            south: { uv: FULL, texture: '#side', cullface: 'south' },
            west: { uv: FULL, texture: '#side', cullface: 'west' },
            east: { uv: FULL, texture: '#side', cullface: 'east' }
          }
        },
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: {
            north: { uv: FULL, texture: '#overlay', tintindex: 0, cullface: 'north' },
            south: { uv: FULL, texture: '#overlay', tintindex: 0, cullface: 'south' },
            west: { uv: FULL, texture: '#overlay', tintindex: 0, cullface: 'west' },
            east: { uv: FULL, texture: '#overlay', tintindex: 0, cullface: 'east' }
          }
        }
      ]
    }),
    [M('grass_block_snow')]: json({
      parent: 'block/cube_column',
      textures: { end: 'block/grass_block_top', side: 'block/grass_block_snow' }
    }),
    [BS('grass_block')]: json({
      variants: {
        'snowy=false': [
          { model: 'minecraft:block/grass_block', y: 90 },
          { model: 'minecraft:block/grass_block' }
        ],
        'snowy=true': { model: 'minecraft:block/grass_block_snow' }
      }
    }),
    [M('oak_log')]: json({
      parent: 'minecraft:block/cube_column',
      textures: { end: 'minecraft:block/oak_log_top', side: 'minecraft:block/oak_log' }
    }),
    [M('oak_log_horizontal')]: json({
      parent: 'minecraft:block/cube_column',
      textures: { end: 'minecraft:block/oak_log_top', side: 'minecraft:block/oak_log' }
    }),
    [BS('oak_log')]: json({
      variants: {
        'axis=x': { model: 'minecraft:block/oak_log_horizontal', x: 90, y: 90 },
        'axis=y': { model: 'minecraft:block/oak_log' },
        'axis=z': { model: 'minecraft:block/oak_log_horizontal', x: 90 }
      }
    }),
    [M('tinted_cross')]: json({
      ambientocclusion: false,
      textures: { particle: '#cross' },
      elements: [
        {
          from: [0.8, 0, 8],
          to: [15.2, 16, 8],
          rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
          shade: false,
          faces: {
            north: { uv: FULL, texture: '#cross', tintindex: 0 },
            south: { uv: FULL, texture: '#cross', tintindex: 0 }
          }
        },
        {
          from: [8, 0, 0.8],
          to: [8, 16, 15.2],
          rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
          shade: false,
          faces: {
            west: { texture: '#cross', tintindex: 0 },
            east: { texture: '#cross', tintindex: 0 }
          }
        }
      ]
    }),
    [M('short_grass')]: json({
      parent: 'block/tinted_cross',
      textures: { cross: 'block/short_grass' }
    }),
    [BS('short_grass')]: json({ variants: { '': { model: 'minecraft:block/short_grass' } } }),
    [M('broken_thing')]: json({
      parent: 'block/does_not_exist',
      textures: { all: 'block/broken_thing' }
    }),
    [M('garbage')]: new TextEncoder().encode('{ not json'),
    'assets/minecraft/models/item/apple.json': json({
      parent: 'minecraft:item/generated',
      textures: { layer0: 'minecraft:item/apple' }
    }),
    'assets/minecraft/models/item/generated.json': json({ parent: 'builtin/generated' })
  }
}

const cubeElement = (textures: Partial<Record<FaceName, string>>): BlockElement => ({
  from: [0, 0, 0],
  to: [16, 16, 16],
  faces: Object.fromEntries(
    Object.entries(textures).map(([face, texture]) => [face, { texture, uv: FULL }])
  )
})

const sameOnAllFaces = (texture: string): Partial<Record<FaceName, string>> =>
  Object.fromEntries(ALL_FACES.map((f) => [f, texture]))

describe('texture.preview', () => {
  let env: TestEnv
  let packId: string
  let emptyPackId: string
  let folder: string
  let emptyFolder: string
  let warnings: string[]
  let entities: Record<string, EntityDefinition>
  let service: ReturnType<typeof createPreviewService>

  async function writeIn(root: string, path: string, data: Uint8Array | string): Promise<void> {
    const abs = join(root, ...path.split('/'))
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, data)
  }

  beforeEach(async () => {
    env = await createTestEnv()
    await env.vanilla.addVersion('26.3', { ...vanillaFiles(), ...vanillaModels() })
    const pack = await env.service.create({
      name: 'Fire',
      description: '',
      base: 'vanilla',
      authoringVersion: '26.3'
    })
    const empty = await env.service.create({
      name: 'Blank',
      description: '',
      base: 'empty',
      authoringVersion: '26.3'
    })
    packId = pack.id
    folder = pack.folder
    emptyPackId = empty.id
    emptyFolder = empty.folder
    warnings = []
    entities = {}
    service = createPreviewService({
      packs: env.service,
      vanilla: env.vanilla,
      warn: (m) => warnings.push(m),
      info: () => undefined,
      findEntity: (path) => entities[path]
    })
  })

  afterEach(async () => {
    await env.cleanup()
  })

  describe('kind by texture folder', () => {
    it('returns an entity definition when one matches, else flat', async () => {
      const path = T('entity/zombie/zombie.png')
      expect(await service.preview(packId, path)).toEqual({ kind: 'flat' })
      const definition: EntityDefinition = {
        id: 'zombie',
        textureSize: [64, 64],
        textures: [path],
        parts: []
      }
      entities[path] = definition
      expect(await service.preview(packId, path)).toEqual({ kind: 'entity', definition })
    })

    it('uses the built-in entity definitions by default', async () => {
      const plain = createPreviewService({ packs: env.service, vanilla: env.vanilla })
      const result = await plain.preview(packId, T('entity/not_a_real_entity.png'))
      expect(result).toEqual({ kind: 'flat' })
    })

    it('returns item for item textures and flat for everything else', async () => {
      expect(await service.preview(packId, T('item/apple.png'))).toEqual({ kind: 'item' })
      for (const key of [
        'gui/sprites/hud/heart/full.png',
        'particle/flame.png',
        'painting/kebab.png'
      ]) {
        expect(await service.preview(packId, T(key))).toEqual({ kind: 'flat' })
      }
    })
  })

  describe('block models', () => {
    it('resolves cube_all through its parent chain (stone)', async () => {
      expect(await service.preview(packId, T('block/stone.png'))).toEqual({
        kind: 'block',
        modelId: 'minecraft:block/stone',
        elements: [cubeElement(sameOnAllFaces(T('block/stone.png')))],
        tints: {}
      })
    })

    it('resolves the grass block with its tinted overlay from the top or side texture', async () => {
      const expected = {
        kind: 'block',
        modelId: 'minecraft:block/grass_block',
        elements: [
          {
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: {
              down: { texture: T('block/dirt.png'), uv: FULL },
              up: { texture: T('block/grass_block_top.png'), uv: FULL, tintindex: 0 },
              north: { texture: T('block/grass_block_side.png'), uv: FULL },
              south: { texture: T('block/grass_block_side.png'), uv: FULL },
              west: { texture: T('block/grass_block_side.png'), uv: FULL },
              east: { texture: T('block/grass_block_side.png'), uv: FULL }
            }
          },
          {
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: Object.fromEntries(
              (['north', 'south', 'west', 'east'] as const).map((f) => [
                f,
                { texture: T('block/grass_block_side_overlay.png'), uv: FULL, tintindex: 0 }
              ])
            )
          }
        ],
        tints: { 0: '#91bd59' }
      }
      expect(await service.preview(packId, T('block/grass_block_top.png'))).toEqual(expected)
      expect(await service.preview(packId, T('block/grass_block_side_overlay.png'))).toEqual(
        expected
      )
      expect(await service.preview(packId, T('block/dirt.png'))).toMatchObject({
        modelId: 'minecraft:block/grass_block'
      })
      // grass_block_snow -> blockstate grass_block -> its snowy variant.
      expect(await service.preview(packId, T('block/grass_block_snow.png'))).toMatchObject({
        modelId: 'minecraft:block/grass_block_snow',
        tints: {}
      })
    })

    it('resolves the oak log column (end/side) and prefers the unrotated variant', async () => {
      const log = T('block/oak_log.png')
      const top = T('block/oak_log_top.png')
      const expected = {
        kind: 'block',
        modelId: 'minecraft:block/oak_log',
        elements: [
          cubeElement({ north: log, south: log, east: log, west: log, up: top, down: top })
        ],
        tints: {}
      }
      expect(await service.preview(packId, top)).toEqual(expected)
      expect(await service.preview(packId, log)).toEqual(expected)
    })

    it('keeps element rotation, shade and default uvs of a cross plant', async () => {
      const grass = T('block/short_grass.png')
      expect(await service.preview(packId, grass)).toEqual({
        kind: 'block',
        modelId: 'minecraft:block/short_grass',
        elements: [
          {
            from: [0.8, 0, 8],
            to: [15.2, 16, 8],
            rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
            shade: false,
            faces: {
              north: { texture: grass, uv: FULL, tintindex: 0 },
              south: { texture: grass, uv: FULL, tintindex: 0 }
            }
          },
          {
            from: [8, 0, 0.8],
            to: [8, 16, 15.2],
            rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true },
            shade: false,
            faces: {
              west: { texture: grass, uv: [0.8, 0, 15.2, 16], tintindex: 0 },
              east: { texture: grass, uv: [0.8, 0, 15.2, 16], tintindex: 0 }
            }
          }
        ],
        tints: { 0: '#91bd59' }
      })
    })

    it('falls back to a cube for broken models and unused textures, with a warning', async () => {
      const broken = T('block/broken_thing.png')
      expect(await service.preview(packId, broken)).toEqual({
        kind: 'block',
        modelId: FALLBACK_MODEL_ID,
        elements: [cubeElement(sameOnAllFaces(broken))],
        tints: {}
      })
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('2 block model(s) could not be resolved')
      expect(warnings[0]).toContain('minecraft:block/broken_thing')
      expect(warnings[0]).toContain('minecraft:block/garbage')
      const diamond = T('block/diamond_ore.png')
      expect(await service.preview(packId, diamond)).toMatchObject({
        modelId: FALLBACK_MODEL_ID,
        elements: [cubeElement(sameOnAllFaces(diamond))]
      })
      // The index is cached: no second warning.
      expect(warnings).toHaveLength(1)
    })

    it('tints the fallback cube of known tinted textures', async () => {
      const water = T('block/water_still.png')
      const preview = await service.preview(packId, water)
      expect(preview).toMatchObject({ modelId: FALLBACK_MODEL_ID, tints: { 0: '#3f76e4' } })
    })
  })

  describe('pack overrides', () => {
    it('uses pack models over vanilla and picks up changes', async () => {
      const location = (await env.service.locate(packId))!
      const first = await service.blockIndex(location)
      expect(await service.blockIndex(location)).toBe(first)

      await writeIn(
        folder,
        M('stone'),
        JSON.stringify({
          parent: 'block/cube_column',
          textures: { end: 'block/stone_top', side: 'block/stone' }
        })
      )
      const stone = T('block/stone.png')
      const top = T('block/stone_top.png')
      expect(await service.preview(packId, stone)).toEqual({
        kind: 'block',
        modelId: 'minecraft:block/stone',
        elements: [
          cubeElement({ north: stone, south: stone, east: stone, west: stone, up: top, down: top })
        ],
        tints: {}
      })
      const second = await service.blockIndex(location)
      expect(second).not.toBe(first)
      expect(await service.blockIndex(location)).toBe(second)

      // Rewriting the file (new mtime) rebuilds the index.
      await writeIn(
        folder,
        M('stone'),
        JSON.stringify({ parent: 'block/cube_all', textures: { all: 'block/stone' } })
      )
      const future = new Date(Date.now() + 10_000)
      await utimes(join(folder, ...M('stone').split('/')), future, future)
      expect(await service.preview(packId, stone)).toMatchObject({
        elements: [cubeElement(sameOnAllFaces(stone))]
      })
      expect(await service.blockIndex(location)).not.toBe(second)
    })

    it('resolves models and blockstates of other namespaces against vanilla parents', async () => {
      await writeIn(
        folder,
        'assets/mymod/models/block/ruby_ore.json',
        JSON.stringify({
          parent: 'minecraft:block/cube_all',
          textures: { all: 'mymod:block/ruby_ore' }
        })
      )
      await writeIn(
        folder,
        'assets/mymod/blockstates/ruby_ore.json',
        JSON.stringify({ variants: { '': { model: 'mymod:block/ruby_ore' } } })
      )
      const ruby = 'assets/mymod/textures/block/ruby_ore.png'
      expect(await service.preview(packId, ruby)).toEqual({
        kind: 'block',
        modelId: 'mymod:block/ruby_ore',
        elements: [cubeElement(sameOnAllFaces(ruby))],
        tints: {}
      })
    })

    it('treats an invalid pack model as broken instead of throwing', async () => {
      await writeIn(folder, M('oak_log'), '{ "parent": ')
      const top = T('block/oak_log_top.png')
      // The blockstate's other (rotated) model still uses the texture.
      expect(await service.preview(packId, top)).toMatchObject({
        modelId: 'minecraft:block/oak_log_horizontal'
      })
      expect(warnings.join('\n')).toContain('minecraft:block/oak_log (')
    })

    it('uses only the pack files for empty packs', async () => {
      const stone = T('block/stone.png')
      expect(await service.preview(emptyPackId, stone)).toMatchObject({
        modelId: FALLBACK_MODEL_ID
      })
      await writeIn(
        emptyFolder,
        M('stone'),
        JSON.stringify({ parent: 'block/cube_all', textures: { all: 'block/stone' } })
      )
      // cube_all is vanilla: an empty pack does not see it.
      expect(await service.preview(emptyPackId, stone)).toMatchObject({
        modelId: FALLBACK_MODEL_ID
      })
      expect(warnings.join('\n')).toContain('minecraft:block/cube_all not found')
      await writeIn(
        emptyFolder,
        M('stone'),
        JSON.stringify({
          textures: { all: 'block/stone' },
          elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces: { up: { texture: '#all' } } }]
        })
      )
      const future = new Date(Date.now() + 10_000)
      await utimes(join(emptyFolder, ...M('stone').split('/')), future, future)
      expect(await service.preview(emptyPackId, stone)).toEqual({
        kind: 'block',
        modelId: 'minecraft:block/stone',
        elements: [
          { from: [0, 0, 0], to: [16, 8, 16], faces: { up: { texture: stone, uv: FULL } } }
        ],
        tints: {}
      })
    })
  })

  describe('errors', () => {
    it('rejects unknown packs', async () => {
      await expect(service.preview('nope', T('block/stone.png'))).rejects.toMatchObject({
        code: 'packs.notFound',
        params: { packId: 'nope' }
      })
    })

    it.each([
      'assets/minecraft/models/block/stone.json',
      'assets/minecraft/textures/block/Stone.png',
      'assets/minecraft/textures/../../../etc/x.png',
      'assets/minecraft/textures/.hidden/x.png',
      'assets/minecraft/textures/block//x.png',
      '/abs/assets/minecraft/textures/block/x.png'
    ])('rejects invalid path %s', async (path) => {
      const error = await service.preview(packId, path).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(AppErrorException)
      expect(error).toMatchObject({ code: 'texture.invalidPath', params: { path } })
    })

    it('never throws when the index cannot be built', async () => {
      const failing = createPreviewService({
        packs: env.service,
        vanilla: {
          getIndex: async () => {
            throw new Error('disk on fire')
          },
          resolveFile: () => null
        },
        warn: (m) => warnings.push(m),
        info: () => undefined
      })
      const stone = T('block/stone.png')
      expect(await failing.preview(packId, stone)).toMatchObject({ modelId: FALLBACK_MODEL_ID })
      expect(warnings.join('\n')).toContain('disk on fire')
    })
  })
})
