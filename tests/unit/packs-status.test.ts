import { encode } from 'fast-png'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { createCategoryEngine } from '@shared/categories'
import type { TextureEntry } from '@shared/model/pack'
import { computeStatus, summarizeCategories } from '../../src/main/services/packs/textures'
import { validatePackFiles } from '../../src/main/services/packs/validation'
import { createDefaultPackIcon, readPngHeader } from '../../src/main/services/packs/png'
import { buildDeterministicZip } from '../../src/main/services/packs/zip'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const png = (w: number, h: number): Uint8Array =>
  encode({ width: w, height: h, data: new Uint8Array(w * h * 4), channels: 4, depth: 8 })
const text = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('texture status', () => {
  it('compares pack and vanilla hashes', () => {
    expect(computeStatus(undefined, 'a')).toBe('vanilla')
    expect(computeStatus(undefined, undefined)).toBe('vanilla')
    expect(computeStatus('a', 'a')).toBe('vanilla')
    expect(computeStatus('a', 'b')).toBe('modified')
    expect(computeStatus('a', undefined)).toBe('added')
  })
})

describe('category summaries', () => {
  const engine = createCategoryEngine([
    {
      id: 'blocks',
      i18nKey: 'category.blocks',
      icon: 'assets/minecraft/textures/block/b.png',
      include: ['block/**'],
      order: 1
    },
    { id: 'items', i18nKey: 'category.items', icon: 'none', include: ['item/**'], order: 2 },
    { id: 'empty', i18nKey: 'category.empty', icon: 'none', include: ['nothing/**'], order: 3 }
  ])
  const entry = (path: string, status: TextureEntry['status']): TextureEntry => ({
    path,
    namespace: 'minecraft',
    folder: '',
    name: '',
    width: 16,
    height: 16,
    animated: false,
    status,
    categories: engine.categorize(path),
    url: `u:${path}`
  })

  it('counts per category in display order, omits empty categories, picks the rule icon', () => {
    const summaries = summarizeCategories(
      [
        entry('assets/minecraft/textures/block/a.png', 'modified'),
        entry('assets/minecraft/textures/block/b.png', 'vanilla'),
        entry('assets/minecraft/textures/item/x.png', 'added'),
        entry('assets/minecraft/textures/misc/y.png', 'vanilla')
      ],
      engine
    )
    expect(summaries).toEqual([
      {
        id: 'blocks',
        i18nKey: 'category.blocks',
        count: 2,
        changedCount: 1,
        iconUrl: 'u:assets/minecraft/textures/block/b.png'
      },
      {
        id: 'items',
        i18nKey: 'category.items',
        count: 1,
        changedCount: 1,
        iconUrl: 'u:assets/minecraft/textures/item/x.png'
      },
      {
        id: 'other',
        i18nKey: 'category.other',
        count: 1,
        changedCount: 0,
        iconUrl: 'u:assets/minecraft/textures/misc/y.png'
      }
    ])
  })
})

describe('PNG header and default icon', () => {
  it('reads IHDR and rejects garbage', () => {
    expect(readPngHeader(png(16, 32))).toMatchObject({
      width: 16,
      height: 32,
      bitDepth: 8,
      colorType: 6
    })
    expect(readPngHeader(text('not a png at all, definitely not a png'))).toBeNull()
    const truncated = png(16, 16).slice(0, 20)
    expect(readPngHeader(truncated)).toBeNull()
  })

  it('generates a deterministic 64x64 icon, from a texture when it decodes', () => {
    const a = createDefaultPackIcon({ seed: 'x' })
    expect(readPngHeader(a)).toMatchObject({ width: 64, height: 64 })
    expect(Buffer.compare(a, createDefaultPackIcon({ seed: 'x' }))).toBe(0)
    expect(Buffer.compare(a, createDefaultPackIcon({ seed: 'y' }))).not.toBe(0)
    const fromTexture = createDefaultPackIcon({ seed: 'x', texture: png(16, 512) })
    expect(readPngHeader(fromTexture)).toMatchObject({ width: 64, height: 64 })
    const fallback = createDefaultPackIcon({ seed: 'x', texture: text('broken') })
    expect(Buffer.compare(fallback, a)).toBe(0)
  })
})

describe('validation', () => {
  it('flags invalid files and leaves valid ones alone', () => {
    const warnings = validatePackFiles([
      { path: 'pack.png', data: png(64, 64) },
      { path: 'pack.mcmeta', data: text('{"pack":{}}') },
      { path: 'assets/minecraft/textures/block/ok.png', data: png(16, 16) },
      { path: 'assets/minecraft/textures/block/anim.png', data: png(16, 64) },
      { path: 'assets/minecraft/textures/block/anim.png.mcmeta', data: text('{"animation":{}}') },
      { path: 'assets/minecraft/textures/block/bad_anim.png', data: png(16, 24) },
      {
        path: 'assets/minecraft/textures/block/bad_anim.png.mcmeta',
        data: text('{"animation":{}}')
      },
      { path: 'assets/minecraft/textures/item/npot.png', data: png(12, 12) },
      { path: 'assets/minecraft/textures/entity/npot_ok.png', data: png(12, 12) },
      { path: 'assets/minecraft/textures/block/fake.png', data: text('nope') },
      { path: 'assets/minecraft/models/x.json', data: text('{') },
      { path: 'assets/minecraft/textures/block/Caps.png', data: png(16, 16) }
    ])
    expect(warnings).toEqual([
      { code: 'export.animationMismatch', path: 'assets/minecraft/textures/block/bad_anim.png' },
      { code: 'export.nonPowerOfTwo', path: 'assets/minecraft/textures/item/npot.png' },
      { code: 'export.invalidPng', path: 'assets/minecraft/textures/block/fake.png' },
      { code: 'export.invalidJson', path: 'assets/minecraft/models/x.json' },
      { code: 'export.invalidPath', path: 'assets/minecraft/textures/block/Caps.png' }
    ])
  })

  it('warns about a missing pack.png', () => {
    expect(validatePackFiles([])).toEqual([{ code: 'export.missingPackPng' }])
  })
})

describe('deterministic zip', () => {
  it('orders entries (pack.mcmeta, pack.png, then sorted) and is reproducible', () => {
    const files = [
      { path: 'b/z.json', data: text('{}') },
      { path: 'pack.png', data: png(1, 1) },
      { path: 'a/y.png', data: png(1, 1) },
      { path: 'pack.mcmeta', data: text('{}') }
    ]
    const zip = buildDeterministicZip(files)
    expect(Object.keys(unzipSync(zip))).toEqual(['pack.mcmeta', 'pack.png', 'a/y.png', 'b/z.json'])
    expect(strFromU8(unzipSync(zip)['b/z.json'])).toBe('{}')
    expect(Buffer.compare(zip, buildDeterministicZip([...files].reverse()))).toBe(0)
  })
})
