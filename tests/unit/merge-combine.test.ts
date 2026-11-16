import { describe, expect, it } from 'vitest'
import { emptyBrief } from '@shared/model/brief'
import { combineBriefs, combineJson, mergeableKind } from '../../src/main/services/merge/combine'

describe('mergeableKind', () => {
  it.each([
    ['assets/minecraft/lang/en_us.json', 'lang'],
    ['assets/mymod/lang/fr_fr.json', 'lang'],
    ['assets/minecraft/sounds.json', 'sounds'],
    ['assets/minecraft/atlases/blocks.json', 'atlas'],
    ['assets/minecraft/font/default.json', 'font'],
    ['assets/minecraft/models/block/stone.json', null],
    ['assets/minecraft/textures/block/stone.png', null]
  ] as const)('%s -> %s', (path, kind) => {
    expect(mergeableKind(path)).toBe(kind)
  })
})

describe('combineJson', () => {
  it('unions lang keys, the highest-priority document winning, top keys first', () => {
    expect(
      combineJson('lang', [
        { 'block.stone': 'Pierre rouge', 'item.ruby': 'Rubis' },
        { 'block.stone': 'Stone', 'block.dirt': 'Dirt' }
      ])
    ).toEqual({ 'block.stone': 'Pierre rouge', 'item.ruby': 'Rubis', 'block.dirt': 'Dirt' })
  })

  it('unions atlas sources and font providers without duplicates', () => {
    const a = { sources: [{ type: 'directory', source: 'block' }] }
    const b = {
      sources: [
        { type: 'directory', source: 'block' },
        { type: 'single', resource: 'x' }
      ]
    }
    expect(combineJson('atlas', [a, b])).toEqual({
      sources: [
        { type: 'directory', source: 'block' },
        { type: 'single', resource: 'x' }
      ]
    })
    expect(
      combineJson('font', [{ providers: [{ type: 'bitmap', file: 'a' }] }, { providers: [] }])
    ).toEqual({ providers: [{ type: 'bitmap', file: 'a' }] })
  })

  it('refuses documents of the wrong shape (they become conflicts)', () => {
    expect(combineJson('lang', [{ a: 'b' }, ['not', 'an', 'object']])).toBeNull()
    expect(combineJson('atlas', [{ sources: 'nope' }, { sources: [] }])).toBeNull()
    expect(combineJson('lang', [])).toBeNull()
  })
})

describe('combineBriefs', () => {
  it('appends new palette colors and rules, keeps the target theme', () => {
    const target = {
      ...emptyBrief(),
      theme: 'Ice',
      palette: [{ hex: '#aaddff' }],
      rules: ['Keep vanilla shapes']
    }
    const source = {
      ...emptyBrief(),
      theme: 'Fire',
      palette: [{ hex: '#AADDFF' }, { hex: '#ff6a00', role: 'flames' }],
      rules: ['Keep vanilla shapes', 'Black outlines']
    }
    expect(combineBriefs(target, [source])).toEqual({
      palette: [{ hex: '#aaddff' }, { hex: '#ff6a00', role: 'flames' }],
      rules: ['Keep vanilla shapes', 'Black outlines']
    })
    expect(combineBriefs({ ...emptyBrief() }, [source])).toMatchObject({ theme: 'Fire' })
    expect(combineBriefs(target, [target])).toBeNull()
  })
})
