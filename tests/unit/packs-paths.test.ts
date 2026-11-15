import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isHiddenPath,
  isInside,
  isJunkPath,
  isUnsafeArchivePath,
  isValidResourcePath,
  slugify
} from '../../src/main/services/packs/paths'
import { findPackRoot, nameFromZipPath } from '../../src/main/services/packs/importer'

describe('archive path safety', () => {
  it.each([
    'pack.mcmeta',
    'assets/minecraft/textures/block/stone.png',
    'MyPack/',
    'a/b/c/',
    'weird name (1).png',
    '..hidden-but-not-parent.png'
  ])('accepts %j', (name) => {
    expect(isUnsafeArchivePath(name)).toBe(false)
  })

  it.each([
    '',
    '../evil.png',
    'a/../../evil.png',
    'a/./b.png',
    '/etc/passwd',
    'C:/Windows/evil.dll',
    'c:evil',
    'a\\..\\evil.png',
    '\\\\server\\share\\x',
    'a//b.png',
    'a/b\0.png',
    'x'.repeat(2000)
  ])('rejects %j', (name) => {
    expect(isUnsafeArchivePath(name)).toBe(true)
  })
})

describe('junk and hidden paths', () => {
  it('detects OS junk', () => {
    expect(isJunkPath('__MACOSX/._pack.png')).toBe(true)
    expect(isJunkPath('assets/.DS_Store')).toBe(true)
    expect(isJunkPath('assets/Thumbs.db')).toBe(true)
    expect(isJunkPath('Desktop.ini')).toBe(true)
    expect(isJunkPath('assets/minecraft/._stone.png')).toBe(true)
    expect(isJunkPath('assets/minecraft/textures/block/stone.png')).toBe(false)
  })

  it('detects hidden segments', () => {
    expect(isHiddenPath('.blocksmith/project.json')).toBe(true)
    expect(isHiddenPath('assets/.git/x')).toBe(true)
    expect(isHiddenPath('assets/minecraft/x.png')).toBe(false)
  })
})

describe('resource locations, slugs, containment', () => {
  it('validates resource path characters', () => {
    expect(isValidResourcePath('assets/minecraft/textures/block/stone_1-a.png')).toBe(true)
    expect(isValidResourcePath('assets/minecraft/textures/block/Stone.png')).toBe(false)
    expect(isValidResourcePath('assets/minecraft/textures/block/st one.png')).toBe(false)
    expect(isValidResourcePath('assets/minecraft/textures/block/pierre-é.png')).toBe(false)
  })

  it('slugifies names', () => {
    expect(slugify('Fire Pack!')).toBe('fire-pack')
    expect(slugify('  Été  Glacé ')).toBe('ete-glace')
    expect(slugify('!!!')).toBe('pack')
    expect(slugify('a'.repeat(100))).toHaveLength(48)
  })

  it('checks containment', () => {
    const root = join('/', 'ws', 'packs', 'a')
    expect(isInside(root, join(root, 'x.png'))).toBe(true)
    expect(isInside(root, root)).toBe(true)
    expect(isInside(root, join('/', 'ws', 'packs', 'a-2', 'x.png'))).toBe(false)
    expect(isInside(root, join(root, '..', 'b'))).toBe(false)
    expect(isInside(root, join(root, '..foo'))).toBe(true)
  })
})

describe('import helpers', () => {
  it('finds the pack root', () => {
    expect(findPackRoot(['pack.mcmeta', 'x/pack.mcmeta'])).toBe('')
    expect(findPackRoot(['P/pack.mcmeta', 'P/assets/x.png', 'readme.txt'])).toBe('P/')
    expect(findPackRoot(['A/pack.mcmeta', 'B/pack.mcmeta'])).toBeNull()
    expect(findPackRoot(['A/B/pack.mcmeta'])).toBeNull()
    expect(findPackRoot([])).toBeNull()
  })

  it('derives a pack name from the zip file name', () => {
    expect(nameFromZipPath('/tmp/Faithful 32x - 1.21.4.zip')).toBe('Faithful 32x - 1.21.4')
    expect(nameFromZipPath('/tmp/.zip')).toBe('Imported pack')
    expect(nameFromZipPath(`/tmp/${'n'.repeat(100)}.ZIP`)).toHaveLength(64)
  })
})
