import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { packAssetUrl, vanillaAssetUrl } from '@shared/assets'
import { resolveAssetUrl, type AssetResolverDeps } from '../../src/main/protocol'

vi.mock('electron', () => ({ protocol: {} }))

describe('bs-asset protocol resolution', () => {
  let root: string
  let packDir: string
  let emptyPackDir: string
  let vanillaDir: string
  let deps: AssetResolverDeps

  const stone = 'assets/minecraft/textures/block/stone.png'
  const dirt = 'assets/minecraft/textures/block/dirt.png'

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'blocksmith-protocol-')))
    packDir = join(root, 'packs', 'p1')
    emptyPackDir = join(root, 'packs', 'p2')
    vanillaDir = join(root, 'vanilla', '26.3')
    await mkdir(join(packDir, 'assets/minecraft/textures/block'), { recursive: true })
    await mkdir(join(packDir, '.blocksmith'), { recursive: true })
    await mkdir(emptyPackDir, { recursive: true })
    await mkdir(join(vanillaDir, 'assets/minecraft/textures/block'), { recursive: true })
    await writeFile(join(packDir, stone), 'pack stone')
    await writeFile(join(packDir, 'pack.png'), 'icon')
    await writeFile(join(packDir, 'pack.mcmeta'), '{}')
    await writeFile(join(packDir, 'notes.txt'), 'text')
    await writeFile(join(packDir, '.blocksmith/project.json'), '{}')
    await writeFile(join(vanillaDir, stone), 'vanilla stone')
    await writeFile(join(vanillaDir, dirt), 'vanilla dirt')
    await writeFile(join(root, 'secret.png'), 'outside')

    const packs: Record<string, { folder: string; base: 'vanilla' | 'empty' }> = {
      p1: { folder: packDir, base: 'vanilla' },
      p2: { folder: emptyPackDir, base: 'empty' }
    }
    deps = {
      vanilla: {
        resolveFile: (versionId, path) =>
          versionId === '26.3' ? join(root, 'vanilla', versionId, ...path.split('/')) : null
      },
      locatePack: async (id) => {
        const p = packs[id]
        return p ? { folder: p.folder, project: { authoringVersion: '26.3', base: p.base } } : null
      }
    }
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('serves a pack file when present', async () => {
    await expect(resolveAssetUrl(packAssetUrl('p1', stone, 'abc'), deps)).resolves.toEqual({
      filePath: join(packDir, stone),
      contentType: 'image/png'
    })
    await expect(resolveAssetUrl(packAssetUrl('p1', 'pack.mcmeta'), deps)).resolves.toMatchObject({
      contentType: 'application/json'
    })
  })

  it('falls back to vanilla for vanilla-based packs only', async () => {
    await expect(resolveAssetUrl(packAssetUrl('p1', dirt), deps)).resolves.toEqual({
      filePath: join(vanillaDir, dirt),
      contentType: 'image/png'
    })
    await expect(resolveAssetUrl(packAssetUrl('p2', dirt), deps)).resolves.toBeNull()
    await expect(resolveAssetUrl(packAssetUrl('nope', dirt), deps)).resolves.toBeNull()
  })

  it('serves vanilla URLs from the cache', async () => {
    await expect(resolveAssetUrl(vanillaAssetUrl('26.3', stone), deps)).resolves.toEqual({
      filePath: join(vanillaDir, stone),
      contentType: 'image/png'
    })
    await expect(resolveAssetUrl(vanillaAssetUrl('1.0', stone), deps)).resolves.toBeNull()
    await expect(
      resolveAssetUrl(vanillaAssetUrl('26.3', 'assets/minecraft/textures/missing.png'), deps)
    ).resolves.toBeNull()
  })

  it('rejects traversal, hidden paths and other extensions', async () => {
    const bad = [
      'bs-asset://pack/p1/../secret.png',
      'bs-asset://pack/p1/%2e%2e/secret.png',
      'bs-asset://pack/p1/assets%2F..%2F..%2Fsecret.png',
      'bs-asset://pack/p1/..%5Csecret.png',
      'bs-asset://vanilla/26.3/../../secret.png',
      packAssetUrl('p1', '.blocksmith/project.json'),
      packAssetUrl('p1', 'notes.txt'),
      'bs-asset://other/p1/pack.png',
      'https://example.com/pack.png',
      'not a url'
    ]
    for (const url of bad) {
      await expect(resolveAssetUrl(url, deps), url).resolves.toBeNull()
    }
  })

  it('rejects files that escape their root through a symlink', async () => {
    await symlink(
      join(root, 'secret.png'),
      join(packDir, 'assets/minecraft/textures/block/link.png')
    )
    await expect(
      resolveAssetUrl(packAssetUrl('p1', 'assets/minecraft/textures/block/link.png'), deps)
    ).resolves.toBeNull()

    const evil: AssetResolverDeps = {
      ...deps,
      vanilla: { resolveFile: () => join(root, 'secret.png') }
    }
    await expect(resolveAssetUrl(vanillaAssetUrl('26.3', stone), evil)).resolves.toBeNull()
  })
})
