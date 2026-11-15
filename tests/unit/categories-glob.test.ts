import { describe, expect, it } from 'vitest'
import { globToRegExp, matchGlob } from '@shared/categories/glob'

describe('glob matcher', () => {
  it('matches literals exactly and escapes regex characters', () => {
    expect(matchGlob('block/stone.png', 'block/stone.png')).toBe(true)
    expect(matchGlob('block/stone.png', 'block/stoneXpng')).toBe(false)
    expect(matchGlob('a+b(c)|d$.png', 'a+b(c)|d$.png')).toBe(true)
    expect(matchGlob('block/stone.png', 'xblock/stone.png')).toBe(false)
  })

  it('* stays inside one path segment', () => {
    expect(matchGlob('block/*_ore.png', 'block/diamond_ore.png')).toBe(true)
    expect(matchGlob('block/*_ore.png', 'block/deepslate_diamond_ore.png')).toBe(true)
    expect(matchGlob('block/*_ore.png', 'block/sub/diamond_ore.png')).toBe(false)
    expect(matchGlob('item/*bucket.png', 'item/bucket.png')).toBe(true)
    expect(matchGlob('item/*_axe.png', 'item/iron_pickaxe.png')).toBe(false)
  })

  it('** crosses segments and **/ matches zero or more directories', () => {
    expect(matchGlob('entity/**', 'entity/zombie/zombie.png')).toBe(true)
    expect(matchGlob('entity/**', 'entity/creeper.png')).toBe(true)
    expect(matchGlob('entity/**', 'item/entity.png')).toBe(false)
    expect(matchGlob('**/*.png', 'a.png')).toBe(true)
    expect(matchGlob('**/*.png', 'a/b/c.png')).toBe(true)
    expect(matchGlob('gui/**/heart/*.png', 'gui/heart/full.png')).toBe(true)
    expect(matchGlob('gui/**/heart/*.png', 'gui/sprites/hud/heart/full.png')).toBe(true)
    expect(matchGlob('a**b', 'a/x/b')).toBe(true)
  })

  it('? matches one non-slash character', () => {
    expect(matchGlob('item/clock_0?.png', 'item/clock_04.png')).toBe(true)
    expect(matchGlob('item/clock_0?.png', 'item/clock_4.png')).toBe(false)
    expect(matchGlob('a?b', 'a/b')).toBe(false)
  })

  it('{a,b} alternatives, nested and with wildcards', () => {
    const re = globToRegExp('item/{apple,bread,cooked_*}.png')
    expect(re.test('item/apple.png')).toBe(true)
    expect(re.test('item/bread.png')).toBe(true)
    expect(re.test('item/cooked_beef.png')).toBe(true)
    expect(re.test('item/golden_apple.png')).toBe(false)
    expect(matchGlob('x/{a,b{1,2}}.png', 'x/b2.png')).toBe(true)
    expect(matchGlob('x/{a,b{1,2}}.png', 'x/b3.png')).toBe(false)
    expect(matchGlob('item/*_{helmet,boots}.png', 'item/iron_boots.png')).toBe(true)
  })

  it('treats an unbalanced brace literally', () => {
    expect(matchGlob('a{b', 'a{b')).toBe(true)
    expect(matchGlob('a}b', 'a}b')).toBe(true)
  })
})
