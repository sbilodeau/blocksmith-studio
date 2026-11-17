import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { packAssetUrl, thumbnailParam, thumbnailSizeFor, withThumbnail } from '@shared/assets'
import {
  ThumbnailCache,
  createThumbnailMaker,
  thumbnailPlan,
  type Box,
  type ImageLike
} from '../../src/main/thumbnails'
import { readAssetBody } from '../../src/main/protocol'

vi.mock('electron', () => ({ protocol: {}, nativeImage: {} }))

describe('thumbnail urls', () => {
  it('asks for a thumbnail only when the original is much larger than the tile', () => {
    expect(thumbnailSizeFor(128, 16, 16)).toBeNull()
    expect(thumbnailSizeFor(128, 16, 512)).toBeNull() // vanilla fire strip: small enough
    expect(thumbnailSizeFor(128, 64, 64)).toBeNull()
    expect(thumbnailSizeFor(128, 512, 512)).toBe(128)
    expect(thumbnailSizeFor(64, 512, 4096)).toBe(64)
    expect(thumbnailSizeFor(100, 512, 512)).toBe(128)
    expect(thumbnailSizeFor(320, 512, 512)).toBeNull() // only 4x the largest size: original
    expect(thumbnailSizeFor(320, 1024, 1024)).toBe(256)
  })

  it('adds and reads the thumb parameter', () => {
    const url = packAssetUrl('p1', 'assets/minecraft/textures/block/a.png', 'abc')
    expect(withThumbnail(url, 128)).toBe(`${url}&thumb=128`)
    expect(thumbnailParam(withThumbnail(url, 128))).toBe(128)
    const bare = packAssetUrl('p1', 'pack.png')
    expect(withThumbnail(bare, 64)).toBe(`${bare}?thumb=64`)
    expect(thumbnailParam(bare)).toBeNull()
    expect(thumbnailParam(`${bare}?thumb=100`)).toBeNull()
    expect(thumbnailParam(`${bare}?thumb=64x`)).toBeNull()
  })
})

describe('thumbnail plan', () => {
  it('fits the image in the box, keeping proportions, never enlarging', () => {
    expect(thumbnailPlan(512, 512, 128)).toEqual({
      crop: { x: 0, y: 0, width: 512, height: 512 },
      width: 128,
      height: 128
    })
    expect(thumbnailPlan(512, 256, 128)).toMatchObject({ width: 128, height: 64 })
    expect(thumbnailPlan(32, 32, 128)).toMatchObject({ width: 32, height: 32 })
  })

  it('keeps the first square frame of a vertical strip', () => {
    expect(thumbnailPlan(512, 4096, 64)).toEqual({
      crop: { x: 0, y: 0, width: 512, height: 512 },
      width: 64,
      height: 64
    })
  })
})

/** Fake NativeImage recording the operations applied to it. */
function fakeImage(width: number, height: number, ops: string[], empty = false): ImageLike {
  return {
    isEmpty: () => empty,
    getSize: () => ({ width, height }),
    crop: (r: Box) => {
      ops.push(`crop ${r.width}x${r.height}`)
      return fakeImage(r.width, r.height, ops)
    },
    resize: (o) => {
      ops.push(`resize ${o.width}x${o.height} ${o.quality}`)
      return fakeImage(o.width, o.height, ops)
    },
    toPNG: () => new TextEncoder().encode(`png ${width}x${height}`)
  }
}

describe('thumbnail maker', () => {
  it('crops strips, resizes and encodes', () => {
    const ops: string[] = []
    const make = createThumbnailMaker(() => fakeImage(512, 4096, ops))
    const out = make(new Uint8Array(1), 128)
    expect(new TextDecoder().decode(out!)).toBe('png 128x128')
    expect(ops).toEqual(['crop 512x512', 'resize 128x128 good'])
  })

  it('returns null for data that does not decode', () => {
    const make = createThumbnailMaker(() => fakeImage(0, 0, [], true))
    expect(make(new Uint8Array(1), 128)).toBeNull()
  })
})

describe('thumbnail cache', () => {
  it('evicts the least recently used entries beyond its byte budget', () => {
    const cache = new ThumbnailCache(10)
    cache.set('a', new Uint8Array(4))
    cache.set('b', new Uint8Array(4))
    expect(cache.get('a')).toBeDefined() // a is now the most recent
    cache.set('c', new Uint8Array(4))
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
    expect(cache.totalBytes).toBe(8)
    // An entry larger than the budget is still kept until the next one.
    cache.set('big', new Uint8Array(20))
    expect(cache.size).toBe(1)
  })
})

describe('asset body', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blocksmith-thumb-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('serves the file, or a cached thumbnail for a PNG with thumb', async () => {
    const file = join(dir, 'a.png')
    await writeFile(file, 'original')
    const thumbnail = vi.fn(() => new TextEncoder().encode('small'))
    const deps = { thumbnail, cache: new ThumbnailCache() }
    const asset = { filePath: file, contentType: 'image/png' }
    const text = (b: Uint8Array): string => new TextDecoder().decode(b)

    expect(text(await readAssetBody(asset, null, deps))).toBe('original')
    expect(text(await readAssetBody(asset, 128, deps))).toBe('small')
    expect(text(await readAssetBody(asset, 128, deps))).toBe('small')
    expect(thumbnail).toHaveBeenCalledTimes(1)
    // JSON is never resized; undecodable PNGs fall back to the original.
    const json = { filePath: file, contentType: 'application/json' }
    expect(text(await readAssetBody(json, 128, deps))).toBe('original')
    thumbnail.mockReturnValueOnce(null as never)
    expect(text(await readAssetBody(asset, 64, deps))).toBe('original')
  })
})
