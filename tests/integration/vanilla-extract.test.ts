import { ENTITY_MODELS_FILE } from '../../src/main/services/entity-models/extract'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { join, relative, sep } from 'path'
import {
  FIXTURE_VERSIONS,
  expectedExtractedPaths,
  makeFixtureJar
} from '../../scripts/make-fixture-jar.mjs'
import { extractVanillaJar, INDEX_FILE } from '../../src/main/services/vanilla/extract'
import type { VanillaIndex } from '@shared/model/vanilla'

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort()
}

describe('extractVanillaJar (fixture jars)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blocksmith-extract-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it.each(['1.21.4', '26.3'] as const)(
    'extracts only the vanilla asset folders of %s and indexes them',
    async (id) => {
      const jarPath = await makeFixtureJar(join(dir, `${id}.jar`), id)
      const outDir = join(dir, 'userData', 'vanilla', id)
      const progress: string[] = []
      const index = await extractVanillaJar(
        { jarPath, outDir, versionId: id },
        (phase, done, total) => progress.push(`${phase}:${done}/${total}`)
      )

      const expected = expectedExtractedPaths(id)
      // 26.x jars carry readable model code: their entity models are written next to the index.
      const extra = id === '26.3' ? [INDEX_FILE, ENTITY_MODELS_FILE] : [INDEX_FILE]
      expect(await listFiles(outDir)).toEqual([...expected, ...extra].sort())
      expect(Object.keys(index.entries).sort()).toEqual(expected)

      // Files that must never be extracted.
      for (const skipped of [
        'net/minecraft/Foo.class',
        'a.class',
        'META-INF/MANIFEST.MF',
        'data/minecraft/worldgen/biome/plains.json',
        'data/minecraft/structure/igloo.nbt',
        'data/minecraft/datapacks/bundle/pack.mcmeta',
        'assets/minecraft/shaders/core/position.vsh',
        'assets/minecraft/lang/deprecated.json',
        'assets/minecraft/sounds.json'
      ]) {
        expect(existsSync(join(outDir, ...skipped.split('/')))).toBe(false)
      }

      // Vanilla data for the data browser (M10).
      expect(index.data).toBe(true)
      expect(existsSync(join(outDir, 'data/minecraft/recipe/stone_slab.json'))).toBe(true)
      expect(index.entries['data/minecraft/tags/item/stone_tool_materials.json']).toBeDefined()
      expect(index.versionId).toBe(id)
      expect(index.resourcePack).toEqual(FIXTURE_VERSIONS[id].resourcePack)
      expect(index.dataPack).toEqual(FIXTURE_VERSIONS[id].dataPack)
      expect(progress[0]).toBe(`extract:0/${expected.length}`)
      expect(progress).toContain(`extract:${expected.length}/${expected.length}`)
      expect(progress.at(-1)).toBe(`index:${expected.length}/${expected.length}`)

      const onDisk: VanillaIndex = JSON.parse(await readFile(join(outDir, INDEX_FILE), 'utf8'))
      expect(onDisk).toEqual(index)
      expect(existsSync(join(outDir, `${INDEX_FILE}.tmp`))).toBe(false)
    }
  )

  it('records sha256, size, PNG dimensions and animation', async () => {
    const jarPath = await makeFixtureJar(join(dir, '26.3.jar'), '26.3')
    const outDir = join(dir, 'vanilla', '26.3')
    const index = await extractVanillaJar({ jarPath, outDir, versionId: '26.3' })

    const stonePath = 'assets/minecraft/textures/block/stone.png'
    const stoneBytes = await readFile(join(outDir, ...stonePath.split('/')))
    expect(index.entries[stonePath]).toEqual({
      path: stonePath,
      sha256: createHash('sha256').update(stoneBytes).digest('hex'),
      size: stoneBytes.byteLength,
      width: 16,
      height: 16
    })

    expect(index.entries['assets/minecraft/textures/entity/zombie/zombie.png']).toMatchObject({
      width: 64,
      height: 64
    })
    expect(index.entries['assets/minecraft/textures/block/fire_0.png']).toMatchObject({
      width: 16,
      height: 512,
      animated: true,
      frameCount: 32
    })
    expect(index.entries['assets/minecraft/textures/block/grass_block_top.png'].animated).toBe(
      undefined
    )
    const model = index.entries['assets/minecraft/models/block/stone.json']
    expect(model.width).toBeUndefined()
    expect(model.size).toBeGreaterThan(0)
    expect(index.entries['assets/minecraft/textures/item/copper_sword.png']).toBeDefined()
  })

  it('replaces a previous interrupted extraction (no index.json) from scratch', async () => {
    const jarPath = await makeFixtureJar(join(dir, '1.21.4.jar'), '1.21.4')
    const outDir = join(dir, 'vanilla', '1.21.4')
    await extractVanillaJar({ jarPath, outDir, versionId: '1.21.4' })
    await rm(join(outDir, INDEX_FILE))
    await writeFile(join(outDir, 'stale.txt'), 'left over')

    await extractVanillaJar({ jarPath, outDir, versionId: '1.21.4' })
    expect(existsSync(join(outDir, 'stale.txt'))).toBe(false)
    expect(existsSync(join(outDir, INDEX_FILE))).toBe(true)
  })

  it('writes index.json last: a failure mid-extraction leaves no index', async () => {
    const jarPath = await makeFixtureJar(join(dir, '26.3.jar'), '26.3')
    const outDir = join(dir, 'vanilla', '26.3')
    const run = extractVanillaJar({ jarPath, outDir, versionId: '26.3' }, (phase, done) => {
      if (phase === 'index' && done === 0) throw new Error('interrupted')
    })
    await expect(run).rejects.toThrow('interrupted')
    expect(existsSync(join(outDir, 'assets', 'minecraft', 'textures', 'block', 'stone.png'))).toBe(
      true
    )
    expect(existsSync(join(outDir, INDEX_FILE))).toBe(false)
  })

  it('ignores zip-slip entries', async () => {
    const jarPath = await makeFixtureJar(join(dir, 'jar', '26.3.jar'), '26.3', {
      includeUnsafeEntries: true
    })
    const outDir = join(dir, 'a', 'b', 'c', 'vanilla', '26.3')
    const index = await extractVanillaJar({ jarPath, outDir, versionId: '26.3' })
    expect(Object.keys(index.entries).sort()).toEqual(expectedExtractedPaths('26.3'))
    // textures/../../../../evil.txt would land in .../vanilla/evil.txt
    expect(existsSync(join(dir, 'a', 'b', 'c', 'vanilla', 'evil.txt'))).toBe(false)
    expect((await listFiles(join(dir, 'a'))).filter((p) => p.includes('evil'))).toEqual([])
    expect(Object.keys(index.entries).some((p) => p.includes('evil') || p.includes('//'))).toBe(
      false
    )
  })

  it('rejects a jar whose version.json does not match the requested version', async () => {
    const jarPath = await makeFixtureJar(join(dir, '26.3.jar'), '26.3')
    await expect(
      extractVanillaJar({ jarPath, outDir: join(dir, 'out'), versionId: '1.21.4' })
    ).rejects.toMatchObject({
      code: 'vanilla.jarVersionMismatch',
      params: { expected: '1.21.4', actual: '26.3' }
    })
    expect(existsSync(join(dir, 'out'))).toBe(false)
  })

  it('rejects files that are not jars', async () => {
    const jarPath = join(dir, 'broken.jar')
    await writeFile(jarPath, 'not a zip')
    await expect(
      extractVanillaJar({ jarPath, outDir: join(dir, 'out'), versionId: '26.3' })
    ).rejects.toMatchObject({ code: 'vanilla.invalidJar' })
    await expect(
      extractVanillaJar({ jarPath: join(dir, 'missing.jar'), outDir: dir, versionId: '26.3' })
    ).rejects.toMatchObject({ code: 'vanilla.invalidJar' })
  })
})

const realJar = join(
  homedir(),
  'Library',
  'Application Support',
  'minecraft',
  'versions',
  '1.21.4',
  '1.21.4.jar'
)

describe.skipIf(!existsSync(realJar))('extractVanillaJar (real local 1.21.4 jar, optional)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blocksmith-realjar-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('extracts and indexes the real jar', { timeout: 120_000 }, async () => {
    const outDir = join(dir, 'vanilla', '1.21.4')
    const index = await extractVanillaJar({ jarPath: realJar, outDir, versionId: '1.21.4' })
    expect(index.resourcePack).toEqual({ major: 46, minor: 0 })
    expect(index.dataPack).toEqual({ major: 61, minor: 0 })
    expect(index.entries['assets/minecraft/textures/block/stone.png']).toMatchObject({
      width: 16,
      height: 16
    })
    const fire = index.entries['assets/minecraft/textures/block/fire_0.png']
    expect(fire.animated).toBe(true)
    expect(fire.frameCount).toBe((fire.height ?? 0) / (fire.width ?? 1))
    expect(index.entries['assets/minecraft/lang/en_us.json']).toBeDefined()
    expect(index.entries['pack.png']).toBeDefined()
    expect(Object.keys(index.entries).some((p) => p.startsWith('assets/minecraft/shaders/'))).toBe(
      false
    )
    expect(Object.keys(index.entries).length).toBeGreaterThan(5000)
  })
})
