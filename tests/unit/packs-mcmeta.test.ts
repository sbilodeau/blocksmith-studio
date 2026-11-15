import { describe, expect, it } from 'vitest'
import {
  mergeMcmeta,
  parseFormatValue,
  parseJson,
  readAnimation,
  readDeclaredFormat,
  stripFormatting,
  textComponentToPlain
} from '../../src/main/services/packs/mcmeta'

describe('text components', () => {
  it('flattens strings, arrays and objects', () => {
    expect(textComponentToPlain('§6Fire §rPack')).toBe('§6Fire §rPack')
    expect(textComponentToPlain(['a', { text: 'b' }, 3])).toBe('ab3')
    expect(
      textComponentToPlain({ text: 'Hot ', extra: [{ text: 'stuff', bold: true }, '!'] })
    ).toBe('Hot stuff!')
    expect(textComponentToPlain({ translate: 'pack.x', fallback: 'Fallback' })).toBe('Fallback')
    expect(textComponentToPlain({ translate: 'pack.x' })).toBe('pack.x')
    expect(textComponentToPlain(null)).toBe('')
    expect(textComponentToPlain({ color: 'red' })).toBe('')
  })

  it('strips legacy formatting codes', () => {
    expect(stripFormatting('§6Fire §lPack')).toBe('Fire Pack')
  })
})

describe('pack formats', () => {
  it('parses int, float and [major, minor] formats', () => {
    expect(parseFormatValue(46)).toEqual({ major: 46, minor: 0 })
    expect(parseFormatValue(69.0)).toEqual({ major: 69, minor: 0 })
    expect(parseFormatValue([97, 1])).toEqual({ major: 97, minor: 1 })
    expect(parseFormatValue([88])).toEqual({ major: 88, minor: 0 })
    expect(parseFormatValue('46')).toBeUndefined()
    expect(parseFormatValue([1, 2, 3])).toBeUndefined()
    expect(parseFormatValue([-1])).toBeUndefined()
  })

  it('reads pack_format first, then min_format', () => {
    expect(readDeclaredFormat({ pack: { pack_format: 46, min_format: 99 } })).toEqual({
      major: 46,
      minor: 0
    })
    expect(readDeclaredFormat({ pack: { min_format: [84, 0], max_format: 97 } })).toEqual({
      major: 84,
      minor: 0
    })
    expect(readDeclaredFormat({ pack: {} })).toBeUndefined()
    expect(readDeclaredFormat('nope')).toBeUndefined()
  })
})

describe('mcmeta merge', () => {
  it('keeps builder sections and adds extra sections from the existing file', () => {
    const built = { pack: { min_format: 97, max_format: 97, description: 'New' } }
    const merged = mergeMcmeta(built, {
      pack: { pack_format: 1, description: 'Old', supported_formats: [1, 2] },
      language: { xx_yy: { name: 'X' } },
      filter: { block: [] }
    })
    expect(merged).toEqual({
      pack: { min_format: 97, max_format: 97, description: 'New' },
      language: { xx_yy: { name: 'X' } },
      filter: { block: [] }
    })
    expect(Object.keys(merged)[0]).toBe('pack')
    expect(mergeMcmeta(built, undefined)).toEqual(built)
    expect(mergeMcmeta(built, [1, 2])).toEqual(built)
  })

  it('parses JSON with a BOM and reports invalid JSON as undefined', () => {
    expect(parseJson('﻿{"a":1}')).toEqual({ a: 1 })
    expect(parseJson(new TextEncoder().encode('{ nope'))).toBeUndefined()
  })
})

describe('animation layout', () => {
  it('defaults to square frames of min(width, height)', () => {
    expect(readAnimation({ animation: {} }, 16, 64)).toEqual({
      frameWidth: 16,
      frameHeight: 16,
      frameCount: 4,
      consistent: true
    })
    expect(readAnimation({ animation: { frametime: 2 } }, 16, 40)).toMatchObject({
      frameCount: 2,
      consistent: false
    })
  })

  it('honours explicit frame sizes and ignores non-animated metadata', () => {
    expect(readAnimation({ animation: { height: 8 } }, 16, 32)).toEqual({
      frameWidth: 16,
      frameHeight: 8,
      frameCount: 4,
      consistent: true
    })
    expect(readAnimation({ villager: {} }, 16, 16)).toBeNull()
    expect(readAnimation(undefined, 16, 16)).toBeNull()
  })
})
