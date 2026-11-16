#!/usr/bin/env node
/**
 * Synthetic Minecraft client jars for tests (no Mojang asset is used or committed).
 *
 *   node scripts/make-fixture-jar.mjs [outDir]    # writes <outDir>/1.21.4.jar and <outDir>/26.3.jar
 *
 * From tests:
 *
 *   import { makeFixtureJar, FIXTURE_VERSIONS } from '../../scripts/make-fixture-jar.mjs'
 *   await makeFixtureJar(join(dir, 'versions/1.21.4/1.21.4.jar'), '1.21.4')
 *
 * Each jar holds tiny generated PNGs at real vanilla paths (one animated 16x512 strip with its .png.mcmeta),
 * a few models / blockstates / item definitions, lang/en_us.json, pack.png and a version.json in the shape the
 * real jar of that version uses. It also holds vanilla data files (recipes, a loot table,
 * tags, an advancement) and files the extractor must ignore (classes, worldgen data, shaders, ...).
 * File contents are deterministic (generated pixels, fixed JSON), so extracted file hashes are stable across runs.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { encode } from 'fast-png'
import { syntheticModelClasses } from './lib/synthetic-models.mjs'

/**
 * Fake versions. `packVersion` is written verbatim into version.json:
 * - 1.21.4 uses the pre-1.21.9 shape `{ resource, data }` (same numbers as the real jar)
 * - 26.3 uses the 1.21.9+ shape `{ resource_major, resource_minor, data_major, data_minor }`
 */
export const FIXTURE_VERSIONS = {
  '1.21.4': {
    id: '1.21.4',
    packVersion: { resource: 46, data: 61 },
    resourcePack: { major: 46, minor: 0 },
    dataPack: { major: 61, minor: 0 }
  },
  26.3: {
    id: '26.3',
    packVersion: { resource_major: 97, resource_minor: 1, data_major: 121, data_minor: 0 },
    resourcePack: { major: 97, minor: 1 },
    dataPack: { major: 121, minor: 0 }
  }
}

const T = 'assets/minecraft/textures/'

/** PNG textures common to both versions: [path, width, height]. */
const COMMON_TEXTURES = [
  [`${T}block/stone.png`, 16, 16],
  [`${T}block/dirt.png`, 16, 16],
  [`${T}block/grass_block_top.png`, 16, 16],
  [`${T}block/grass_block_side.png`, 16, 16],
  [`${T}block/oak_planks.png`, 16, 16],
  [`${T}block/oak_log.png`, 16, 16],
  [`${T}block/oak_log_top.png`, 16, 16],
  [`${T}block/glass.png`, 16, 16],
  [`${T}block/fire_0.png`, 16, 512],
  [`${T}item/diamond_sword.png`, 16, 16],
  [`${T}item/apple.png`, 16, 16],
  [`${T}item/stick.png`, 16, 16],
  [`${T}entity/zombie/zombie.png`, 64, 64],
  [`${T}entity/chest/normal.png`, 64, 64],
  [`${T}gui/sprites/hud/heart/full.png`, 9, 9],
  [`${T}gui/title/background/panorama_0.png`, 32, 32],
  [`${T}particle/flame.png`, 8, 8],
  [`${T}particle/note.png`, 8, 8],
  [`${T}painting/kebab.png`, 16, 16],
  [`${T}environment/sun.png`, 32, 32],
  [`${T}colormap/grass.png`, 16, 16]
]

/** Extra textures only in 26.3 (added by 1.21.9 "copper" content), to tell the two fixtures apart. */
const TEXTURES_26_3 = [
  [`${T}item/copper_sword.png`, 16, 16],
  [`${T}block/copper_torch.png`, 16, 16]
]

/** Deterministic pixels derived from the path (simple hash -> base color + checker pattern). */
function texture(path, width, height) {
  let hash = 2166136261
  for (let i = 0; i < path.length; i++) hash = Math.imul(hash ^ path.charCodeAt(i), 16777619) >>> 0
  const r = hash & 0xff
  const g = (hash >>> 8) & 0xff
  const b = (hash >>> 16) & 0xff
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const shade = ((x >> 1) + (y >> 1)) % 2 === 0 ? 0 : 40
      data[i] = Math.max(0, r - shade)
      data[i + 1] = Math.max(0, g - shade)
      data[i + 2] = Math.max(0, b - shade)
      data[i + 3] = 255
    }
  }
  return encode({ width, height, data, channels: 4, depth: 8 })
}

const json = (value) => strToU8(JSON.stringify(value, null, 2))

/**
 * Files of the fixture jar for `versionId`, as `{ path: bytes }`.
 * @param {keyof typeof FIXTURE_VERSIONS} versionId
 * @param {{ includeUnsafeEntries?: boolean }} [options] adds zip-slip entries (`..`, absolute, backslash)
 * @returns {Record<string, Uint8Array>}
 */
export function fixtureJarFiles(versionId, options = {}) {
  const version = FIXTURE_VERSIONS[versionId]
  if (!version) throw new Error(`Unknown fixture version ${versionId}`)
  const textures = versionId === '26.3' ? [...COMMON_TEXTURES, ...TEXTURES_26_3] : COMMON_TEXTURES

  /** @type {Record<string, Uint8Array>} */
  const files = {}
  for (const [path, w, h] of textures) files[path] = texture(path, w, h)

  Object.assign(files, {
    [`${T}block/fire_0.png.mcmeta`]: json({ animation: { frametime: 1 } }),
    'assets/minecraft/models/block/cube_all.json': json({
      parent: 'block/cube',
      textures: { particle: '#all', down: '#all', up: '#all', north: '#all' }
    }),
    'assets/minecraft/models/block/stone.json': json({
      parent: 'minecraft:block/cube_all',
      textures: { all: 'minecraft:block/stone' }
    }),
    'assets/minecraft/models/item/diamond_sword.json': json({
      parent: 'minecraft:item/handheld',
      textures: { layer0: 'minecraft:item/diamond_sword' }
    }),
    'assets/minecraft/blockstates/stone.json': json({
      variants: { '': { model: 'minecraft:block/stone' } }
    }),
    'assets/minecraft/items/diamond_sword.json': json({
      model: { type: 'minecraft:model', model: 'minecraft:item/diamond_sword' }
    }),
    'assets/minecraft/atlases/blocks.json': json({
      sources: [{ type: 'directory', source: 'block', prefix: 'block/' }]
    }),
    'assets/minecraft/font/default.json': json({ providers: [] }),
    // Vanilla data shown by the data browser (written for the fixture, valid in every supported version).
    'data/minecraft/recipe/stone_slab.json': json({
      type: 'minecraft:crafting_shaped',
      category: 'building',
      key: { '#': 'minecraft:stone' },
      pattern: ['###'],
      result: { count: 6, id: 'minecraft:stone_slab' }
    }),
    'data/minecraft/recipe/stone_from_smelting.json': json({
      type: 'minecraft:smelting',
      cookingtime: 200,
      experience: 0.1,
      ingredient: 'minecraft:cobblestone',
      result: { id: 'minecraft:stone' }
    }),
    'data/minecraft/loot_table/blocks/stone.json': json({
      type: 'minecraft:block',
      pools: [{ entries: [{ type: 'minecraft:item', name: 'minecraft:cobblestone' }], rolls: 1 }],
      random_sequence: 'minecraft:blocks/stone'
    }),
    'data/minecraft/tags/item/stone_tool_materials.json': json({
      values: ['minecraft:cobblestone', 'minecraft:blackstone']
    }),
    'data/minecraft/tags/block/base_stone_overworld.json': json({
      values: ['minecraft:stone', 'minecraft:granite']
    }),
    'data/minecraft/advancement/story/root.json': json({
      criteria: {
        crafting_table: {
          conditions: { items: [{ items: 'minecraft:crafting_table' }] },
          trigger: 'minecraft:inventory_changed'
        }
      },
      display: {
        description: { translate: 'advancements.story.root.description' },
        icon: { id: 'minecraft:grass_block' },
        title: { translate: 'advancements.story.root.title' }
      },
      requirements: [['crafting_table']]
    }),
    'assets/minecraft/lang/en_us.json': json({
      'block.minecraft.stone': 'Stone',
      'item.minecraft.diamond_sword': 'Diamond Sword'
    }),
    'pack.png': texture('pack.png', 64, 64),
    'version.json': json({
      id: version.id,
      name: version.id,
      world_version: 4000,
      series_id: 'main',
      protocol_version: 769,
      pack_version: version.packVersion,
      build_time: '2026-01-01T00:00:00+00:00',
      stable: true
    }),
    // Not extracted:
    'META-INF/MANIFEST.MF': strToU8('Manifest-Version: 1.0\n'),
    'net/minecraft/Foo.class': new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
    'a.class': new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
    'data/minecraft/worldgen/biome/plains.json': json({ temperature: 0.8 }),
    'data/minecraft/structure/igloo.nbt': new Uint8Array([10, 0, 0, 0]),
    'data/minecraft/datapacks/bundle/pack.mcmeta': json({ pack: { pack_format: 1 } }),
    'assets/minecraft/shaders/core/position.vsh': strToU8('#version 150\n'),
    'assets/minecraft/lang/deprecated.json': json({ renamed: {} }),
    'assets/minecraft/sounds.json': json({}),
    'assets/minecraft/texts/splashes.txt': strToU8('Fixture!\n'),
    'assets/realms/textures/gui/realms/news_icon.png': texture('realms', 16, 16)
  })

  // 26.x jars ship readable model code: synthetic model classes (scripts/lib/synthetic-models.mjs) stand in for it.
  // The 1.21.4 jar has none, like an obfuscated jar.
  if (versionId === '26.3') Object.assign(files, syntheticModelClasses())

  if (options.includeUnsafeEntries) {
    files[`${T}../../../../evil.txt`] = strToU8('zip slip')
    files[`${T}block\\..\\..\\evil.png`] = strToU8('backslash')
    files[`${T}block//double.png`] = strToU8('empty segment')
  }
  return files
}

/**
 * Paths the vanilla extractor must produce for `versionId` (everything under assets/minecraft/{textures,
 * models,blockstates,items,atlases,font}, lang/en_us.json, pack.png, version.json and the JSON files under
 * data/minecraft/{recipe,loot_table,tags,advancement}).
 * @param {keyof typeof FIXTURE_VERSIONS} versionId
 */
export function expectedExtractedPaths(versionId) {
  const wanted = /^assets\/minecraft\/(textures|models|blockstates|items|atlases|font)\//
  const data = /^data\/minecraft\/(recipe|loot_table|tags|advancement)\/.+\.json$/
  return Object.keys(fixtureJarFiles(versionId))
    .filter(
      (p) =>
        wanted.test(p) ||
        data.test(p) ||
        p === 'assets/minecraft/lang/en_us.json' ||
        p === 'pack.png' ||
        p === 'version.json'
    )
    .sort()
}

/**
 * Builds the fixture jar bytes.
 * @param {keyof typeof FIXTURE_VERSIONS} versionId
 * @param {{ includeUnsafeEntries?: boolean }} [options]
 */
export function fixtureJarBytes(versionId, options = {}) {
  return zipSync(fixtureJarFiles(versionId, options), {
    level: 6,
    mtime: new Date('2026-01-01T00:00:00Z')
  })
}

/**
 * Writes a fixture jar to `outPath` (parent folders are created) and returns `outPath`.
 * @param {string} outPath
 * @param {keyof typeof FIXTURE_VERSIONS} versionId
 * @param {{ includeUnsafeEntries?: boolean }} [options]
 */
export async function makeFixtureJar(outPath, versionId, options = {}) {
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, fixtureJarBytes(versionId, options))
  return outPath
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outDir = resolve(process.argv[2] ?? join(tmpdir(), 'blocksmith-fixture-jars'))
  for (const id of Object.keys(FIXTURE_VERSIONS)) {
    const path = await makeFixtureJar(join(outDir, `${id}.jar`), id)
    console.log(`Wrote ${path}`)
  }
}
