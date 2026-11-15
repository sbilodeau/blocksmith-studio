/**
 * Optional check against a real Minecraft 1.21.4 client jar (skipped when absent, e.g. in CI). Models and
 * blockstates are extracted into a temp folder that is deleted afterwards: no Mojang asset enters the repo.
 * Override the jar location with BLOCKSMITH_REAL_JAR.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Project } from '@shared/model/pack'
import type { BlockPreview } from '@shared/model/preview'
import { FakeVanillaStore, T } from './packs-fixtures'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createPreviewService, FALLBACK_MODEL_ID } = await import('../../src/main/services/preview')

const JAR =
  process.env['BLOCKSMITH_REAL_JAR'] ??
  join(homedir(), 'Library/Application Support/minecraft/versions/1.21.4/1.21.4.jar')

describe.skipIf(!existsSync(JAR))('3D preview against the real 1.21.4 jar', () => {
  let root: string
  let service: ReturnType<typeof createPreviewService>
  const infos: string[] = []
  const warnings: string[] = []
  const blockTextures: string[] = []

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'blocksmith-preview-jar-'))
    const entries = unzipSync(new Uint8Array(readFileSync(JAR)), {
      filter: (f) => {
        if (/^assets\/minecraft\/textures\/block\/[^/]+\.png$/.test(f.name))
          blockTextures.push(f.name)
        return /^assets\/minecraft\/(models|blockstates)\/.+\.json$/.test(f.name)
      }
    })
    const vanilla = new FakeVanillaStore(join(root, 'vanilla'))
    await vanilla.addVersion('1.21.4', entries)
    const project: Project = {
      schemaVersion: 1,
      id: 'real',
      name: 'Real',
      description: '',
      authoringVersion: '1.21.4',
      base: 'vanilla',
      createdAt: '2026-11-15T00:00:00.000Z',
      updatedAt: '2026-11-15T00:00:00.000Z'
    }
    const folder = join(root, 'pack')
    service = createPreviewService({
      packs: { locate: async (id) => (id === 'real' ? { id, folder, project } : null) },
      vanilla,
      warn: (m) => warnings.push(m),
      info: (m) => infos.push(m)
    })
  }, 60_000)

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function block(name: string): Promise<BlockPreview> {
    const result = await service.preview('real', T(`block/${name}.png`))
    expect(result.kind).toBe('block')
    return result as BlockPreview
  }

  it('builds the index quickly, then answers in a few ms', async () => {
    let started = performance.now()
    await block('stone')
    const cold = performance.now() - started
    started = performance.now()
    for (let i = 0; i < 20; i++) await block('oak_log')
    const warm = (performance.now() - started) / 20
    console.info(`${infos.join('\n')}\ncold ${cold.toFixed(0)} ms, warm ${warm.toFixed(2)} ms`)
    expect(warnings).toEqual([])
    expect(warm).toBeLessThan(20)
  })

  it.each([
    ['grass_block_top', 'minecraft:block/grass_block'],
    ['grass_block_side_overlay', 'minecraft:block/grass_block'],
    ['oak_log', 'minecraft:block/oak_log'],
    ['oak_log_top', 'minecraft:block/oak_log'],
    ['glass', 'minecraft:block/glass'],
    ['short_grass', 'minecraft:block/short_grass'],
    ['diamond_ore', 'minecraft:block/diamond_ore'],
    ['oak_leaves', 'minecraft:block/oak_leaves'],
    ['tall_grass_top', 'minecraft:block/tall_grass_top'],
    ['furnace_front_on', 'minecraft:block/furnace_on']
  ])('%s resolves to %s', async (texture, modelId) => {
    const preview = await block(texture)
    expect(preview.modelId).toBe(modelId)
    expect(preview.modelId).not.toBe(FALLBACK_MODEL_ID)
  })

  it('finds a model for most block textures', async () => {
    const fallbacks: string[] = []
    for (const path of blockTextures) {
      const preview = (await service.preview('real', path)) as BlockPreview
      if (preview.modelId === FALLBACK_MODEL_ID)
        fallbacks.push(path.slice(path.lastIndexOf('/') + 1))
    }
    console.info(
      `${blockTextures.length - fallbacks.length}/${blockTextures.length} block textures have a model; ` +
        `fallback cube: ${fallbacks.join(', ')}`
    )
    expect(fallbacks.length).toBeLessThan(blockTextures.length * 0.1)
  })

  it('tints the grass block and the leaves', async () => {
    expect((await block('grass_block_top')).tints).toEqual({ 0: '#91bd59' })
    expect((await block('birch_leaves')).tints).toEqual({ 0: '#80a755' })
    expect((await block('stone')).tints).toEqual({})
  })
})
