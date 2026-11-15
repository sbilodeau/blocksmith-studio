import { describe, expect, it } from 'vitest'
import { DEFAULT_TINT, knownTint, tintFor } from '../../src/main/services/preview/tints'

describe('default block tints', () => {
  it.each([
    ['grass_block', '#91bd59'],
    ['short_grass', '#91bd59'],
    ['sugar_cane', '#91bd59'],
    ['oak_leaves', '#77ab2f'],
    ['vine', '#77ab2f'],
    ['birch_leaves', '#80a755'],
    ['spruce_leaves', '#619961'],
    ['water', '#3f76e4'],
    ['redstone_wire', '#ff3300'],
    ['lily_pad', '#208030'],
    ['attached_pumpkin_stem', '#e0c71c'],
    ['cherry_leaves', '#ffffff']
  ])('%s -> %s', (name, color) => {
    expect(tintFor(name)).toBe(color)
  })

  it('accepts model ids and model names with suffixes', () => {
    expect(tintFor('minecraft:block/large_fern_top')).toBe('#91bd59')
    expect(tintFor('minecraft:block/water_cauldron_level1')).toBe('#3f76e4')
    expect(tintFor('redstone_dust_dot')).toBe('#ff3300')
    expect(tintFor('melon_stem_stage3')).toBe('#e0c71c')
    expect(tintFor('bamboo_large_leaves')).toBe('#ffffff')
  })

  it('treats unknown *_leaves as foliage and anything else as grass', () => {
    expect(tintFor('mymod:block/maple_leaves')).toBe('#77ab2f')
    expect(tintFor('stonecutter')).toBe('#ffffff')
    expect(tintFor('mystery_block')).toBe(DEFAULT_TINT)
    expect(DEFAULT_TINT).toBe('#91bd59')
    expect(knownTint('mystery_block')).toBeUndefined()
  })
})
