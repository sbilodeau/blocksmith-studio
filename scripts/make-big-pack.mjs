#!/usr/bin/env node
/**
 * Synthetic "huge pack" for performance measurements (generated pixels only, never Mojang assets).
 *
 *   node scripts/make-big-pack.mjs <workspaceDir> [--small 10000] [--large 2000] [--animated 50]
 *                                  [--large-size 512] [--name "Big pack"]
 *
 * Writes <workspaceDir>/packs/<slug>/ as an empty-based resource pack (no vanilla needed):
 * - `small` textures of 16x16 spread over block/, item/, entity/, particle/ and gui/ folders,
 * - `large` textures of large-size x large-size (512 by default), of which `animated` are vertical strips
 *   up to 4096 px tall (large-size x 4096) with a `.png.mcmeta`.
 * Large textures get low-amplitude noise so they compress like real high-resolution art (a few hundred KB each).
 * Only a few distinct images are encoded per size and their bytes reused, so generation stays fast; the app still
 * reads, hashes and decodes every file on its own.
 *
 * From code: `import { makeBigPack } from './make-big-pack.mjs'` returns `{ folder, packId, files, bytes }`.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { encode } from 'fast-png'

const T = 'assets/minecraft/textures/'
const SMALL_FOLDERS = ['block', 'item', 'entity/big', 'particle', 'gui/sprites/big']
const ITEM_SUFFIXES = ['', '_sword', '_pickaxe', '_ingot', '_apple', '_helmet']
const VARIANTS = 8

/** Deterministic pseudo-random generator (mulberry32). */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A gradient with a checker pattern and optional low-amplitude noise, as PNG bytes. */
function makeImage(width, height, seed, noise) {
  const rand = rng(seed)
  const data = new Uint8Array(width * height * 4)
  const base = [rand() * 200, rand() * 200, rand() * 200]
  const cell = Math.max(1, width >> 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const checker = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) * 30
      const n = noise ? Math.floor(rand() * noise) : 0
      data[o] = (base[0] + (x * 40) / width + checker + n) & 255
      data[o + 1] = (base[1] + ((y % width) * 40) / width + n) & 255
      data[o + 2] = (base[2] + checker + n) & 255
      data[o + 3] = 255
    }
  }
  return encode({ width, height, data, channels: 4, depth: 8 })
}

function slug(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'pack'
  )
}

function pad(n) {
  return String(n).padStart(5, '0')
}

/** Writes files with bounded concurrency. */
async function writeAll(items, limit = 64) {
  let next = 0
  async function worker() {
    while (next < items.length) {
      const [path, data] = items[next++]
      await writeFile(path, data)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export async function makeBigPack(workspaceDir, options = {}) {
  const small = options.small ?? 10_000
  const large = options.large ?? 2_000
  const animated = Math.min(options.animated ?? 50, large)
  const largeSize = options.largeSize ?? 512
  const name = options.name ?? 'Big pack'
  const packId = options.packId ?? 'bigpack00001'
  const folder = join(resolve(workspaceDir), 'packs', slug(name))

  const smallPngs = Array.from({ length: VARIANTS }, (_, i) => makeImage(16, 16, 1 + i, 0))
  const largePngs = Array.from({ length: VARIANTS }, (_, i) =>
    makeImage(largeSize, largeSize, 100 + i, 24)
  )
  const stripHeight = Math.min(4096, largeSize * Math.max(1, Math.floor(4096 / largeSize)))
  const stripPngs = Array.from({ length: 2 }, (_, i) =>
    makeImage(largeSize, stripHeight, 200 + i, 24)
  )
  const mcmeta = new TextEncoder().encode(JSON.stringify({ animation: { frametime: 2 } }))

  /** [relative path, bytes] */
  const files = []
  for (let i = 0; i < small; i++) {
    const dir = SMALL_FOLDERS[i % SMALL_FOLDERS.length]
    const suffix = dir === 'item' ? ITEM_SUFFIXES[((i / SMALL_FOLDERS.length) % 6) | 0] : ''
    files.push([`${T}${dir}/small_${pad(i)}${suffix}.png`, smallPngs[i % VARIANTS]])
  }
  for (let i = 0; i < large; i++) {
    const dir = i % 2 === 0 ? 'block' : 'item'
    if (i < animated) {
      const path = `${T}${dir}/hd_anim_${pad(i)}.png`
      files.push([path, stripPngs[i % stripPngs.length]])
      files.push([`${path}.mcmeta`, mcmeta])
    } else {
      files.push([`${T}${dir}/hd_${pad(i)}.png`, largePngs[i % VARIANTS]])
    }
  }

  const dirs = new Set(files.map(([p]) => p.slice(0, p.lastIndexOf('/'))))
  await mkdir(join(folder, '.blocksmith'), { recursive: true })
  for (const d of dirs) await mkdir(join(folder, ...d.split('/')), { recursive: true })

  const now = new Date().toISOString()
  const project = {
    schemaVersion: 1,
    id: packId,
    name,
    description: 'Synthetic pack for performance measurements',
    authoringVersion: options.authoringVersion ?? '26.3',
    base: 'empty',
    kind: 'resource',
    createdAt: now,
    updatedAt: now
  }
  const enc = new TextEncoder()
  const meta = {
    pack: { description: project.description, min_format: [97, 1], max_format: [97, 1] }
  }
  await writeFile(join(folder, '.blocksmith', 'project.json'), JSON.stringify(project, null, 2))
  await writeFile(join(folder, 'pack.mcmeta'), enc.encode(JSON.stringify(meta, null, 2)))
  await writeFile(join(folder, 'pack.png'), smallPngs[0])
  await writeAll(files.map(([p, data]) => [join(folder, ...p.split('/')), data]))

  const bytes = files.reduce((sum, [, data]) => sum + data.length, 0)
  return { folder, packId, files: files.length, bytes }
}

function parseArgs(argv) {
  const out = { dir: undefined, options: {} }
  const keys = {
    '--small': 'small',
    '--large': 'large',
    '--animated': 'animated',
    '--large-size': 'largeSize'
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a in keys) out.options[keys[a]] = Number(argv[++i])
    else if (a === '--name') out.options.name = argv[++i]
    else if (!a.startsWith('--')) out.dir = a
  }
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { dir, options } = parseArgs(process.argv.slice(2))
  if (!dir) {
    console.error(
      'usage: node scripts/make-big-pack.mjs <workspaceDir> [--small N] [--large N] [--animated N]'
    )
    process.exit(1)
  }
  const started = Date.now()
  const result = await makeBigPack(dir, options)
  console.log(
    `${result.folder}: ${result.files} files, ${(result.bytes / 1024 / 1024).toFixed(1)} MiB in ${Date.now() - started} ms`
  )
}
