import { describe, expect, it } from 'vitest'
import { join, resolve } from 'path'
import {
  isSafeRelativePath,
  isSafeVersionId,
  resolveInside
} from '../../src/main/services/vanilla/paths'
import { isExtractedAsset } from '../../src/main/services/vanilla/extract'

describe('isSafeRelativePath', () => {
  it.each([
    'assets/minecraft/textures/block/stone.png',
    'pack.png',
    'version.json',
    'assets/minecraft/textures/block/fire_0.png.mcmeta',
    'a/b..c/d'
  ])('accepts %s', (path) => {
    expect(isSafeRelativePath(path)).toBe(true)
  })

  it.each([
    '',
    '..',
    '../x',
    'assets/../../x',
    'assets/minecraft/textures/..',
    './pack.png',
    'assets/./x',
    '/etc/passwd',
    'C:/Windows/x',
    'c:x',
    'assets\\minecraft\\x.png',
    'assets/minecraft\\..\\..\\x',
    'assets//x',
    'assets/x/',
    'assets/x\0.png',
    'a'.repeat(513)
  ])('rejects %j', (path) => {
    expect(isSafeRelativePath(path)).toBe(false)
  })
})

describe('resolveInside', () => {
  const root = resolve('/tmp/blocksmith-root')

  it('joins safe paths below the root', () => {
    expect(resolveInside(root, 'assets/minecraft/textures/block/stone.png')).toBe(
      join(root, 'assets', 'minecraft', 'textures', 'block', 'stone.png')
    )
  })

  it('accepts names that merely start with two dots', () => {
    expect(resolveInside(root, '..hidden/file.png')).toBe(join(root, '..hidden', 'file.png'))
  })

  it.each(['../outside.png', 'a/../../outside', '/abs', 'a\\b', ''])('rejects %j', (path) => {
    expect(resolveInside(root, path)).toBeNull()
  })
})

describe('isSafeVersionId', () => {
  it.each(['1.21.4', '26.3', '26.1.2', '1.21.5-rc1'])('accepts %s', (id) => {
    expect(isSafeVersionId(id)).toBe(true)
  })

  it.each(['', '..', '1..2', '../26.3', '26.3/..', 'a1', '26.3\\x', '26 3'])('rejects %j', (id) => {
    expect(isSafeVersionId(id)).toBe(false)
  })
})

describe('isExtractedAsset', () => {
  it.each([
    'assets/minecraft/textures/block/stone.png',
    'assets/minecraft/textures/block/fire_0.png.mcmeta',
    'assets/minecraft/models/block/stone.json',
    'assets/minecraft/blockstates/stone.json',
    'assets/minecraft/items/diamond_sword.json',
    'assets/minecraft/atlases/blocks.json',
    'assets/minecraft/font/default.json',
    'assets/minecraft/lang/en_us.json',
    'pack.png',
    'version.json'
  ])('extracts %s', (name) => {
    expect(isExtractedAsset(name)).toBe(true)
  })

  it.each([
    'net/minecraft/Foo.class',
    'a.class',
    'META-INF/MANIFEST.MF',
    'data/minecraft/recipe/stone_slab.json',
    'assets/minecraft/shaders/core/position.vsh',
    'assets/minecraft/lang/deprecated.json',
    'assets/minecraft/lang/fr_fr.json',
    'assets/minecraft/sounds.json',
    'assets/realms/textures/gui/realms/news_icon.png',
    'assets/minecraft/textures/',
    'assets/minecraft/textures/../../../evil.txt',
    'assets/minecraft/textures/block\\..\\..\\evil.png',
    'sub/pack.png'
  ])('skips %s', (name) => {
    expect(isExtractedAsset(name)).toBe(false)
  })
})
