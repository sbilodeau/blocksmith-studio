import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CATEGORY_RULES,
  FALLBACK_CATEGORY,
  createCategoryEngine,
  getDefaultCategoryEngine,
  splitTexturePath,
  textureKey
} from '@shared/categories'

const tex = (key: string): string => `assets/minecraft/textures/${key}`

describe('category engine (default mapping)', () => {
  const engine = getDefaultCategoryEngine()
  const cats = (key: string): string[] => engine.categorize(tex(key))

  it('has all default categories, in display order, with i18n keys', () => {
    expect(engine.rules.map((r) => r.id)).toEqual([
      'blocks',
      'ores',
      'tools',
      'weapons',
      'armor',
      'food',
      'materials',
      'entities',
      'gui',
      'particles',
      'environment',
      'other'
    ])
    for (const rule of DEFAULT_CATEGORY_RULES) {
      expect(rule.i18nKey).toBe(`category.${rule.id}`)
      expect(rule.icon).toMatch(/^assets\/minecraft\/textures\/.+\.png$/)
    }
  })

  it.each([
    ['block/stone.png', ['blocks']],
    ['block/diamond_ore.png', ['blocks', 'ores']],
    ['block/deepslate_iron_ore.png', ['blocks', 'ores']],
    ['block/raw_gold_block.png', ['blocks', 'ores']],
    ['block/ancient_debris_side.png', ['blocks', 'ores']],
    ['block/spore_blossom.png', ['blocks']],
    ['item/raw_iron.png', ['ores']],
    ['item/diamond_pickaxe.png', ['tools']],
    ['item/netherite_axe.png', ['tools']],
    ['item/copper_shovel.png', ['tools']],
    ['item/fishing_rod_cast.png', ['tools']],
    ['item/compass_12.png', ['tools']],
    ['item/water_bucket.png', ['tools']],
    ['item/milk_bucket.png', ['tools', 'food']],
    ['item/iron_sword.png', ['weapons']],
    ['item/bow_pulling_2.png', ['weapons']],
    ['item/crossbow_firework.png', ['weapons']],
    ['item/trident.png', ['weapons']],
    ['item/mace.png', ['weapons']],
    ['item/tipped_arrow_head.png', ['weapons']],
    ['item/iron_spear.png', ['weapons']],
    ['item/diamond_helmet.png', ['armor']],
    ['item/turtle_helmet.png', ['armor']],
    ['item/leather_boots_overlay.png', ['armor']],
    ['item/golden_horse_armor.png', ['armor']],
    ['item/elytra_broken.png', ['armor']],
    ['item/wolf_armor_overlay.png', ['armor']],
    ['item/coast_armor_trim_smithing_template.png', ['armor']],
    ['entity/equipment/humanoid/diamond.png', ['armor']],
    ['trims/color_palettes/gold.png', ['armor']],
    ['item/apple.png', ['food']],
    ['item/cooked_beef.png', ['food']],
    ['item/golden_carrot.png', ['food']],
    ['item/cake.png', ['blocks', 'food']],
    ['item/iron_ingot.png', ['materials']],
    ['item/gold_nugget.png', ['materials']],
    ['item/red_dye.png', ['materials']],
    ['item/diamond.png', ['materials']],
    ['item/stick.png', ['materials']],
    ['item/wheat_seeds.png', ['materials']],
    ['item/netherite_upgrade_smithing_template.png', ['materials']],
    ['entity/zombie/zombie.png', ['entities']],
    ['entity/chest/normal.png', ['entities']],
    ['gui/sprites/hud/heart/full.png', ['gui']],
    ['gui/title/minecraft.png', ['gui']],
    ['font/ascii.png', ['gui']],
    ['particle/flame.png', ['particles']],
    ['environment/sun.png', ['environment']],
    ['misc/enchanted_glint_item.png', ['environment']],
    ['painting/kebab.png', ['environment']],
    ['mob_effect/speed.png', ['environment']],
    ['map/decorations/player.png', ['environment']],
    ['item/oak_door.png', ['blocks']],
    ['item/red_candle.png', ['blocks']],
    ['item/music_disc_cat.png', ['other']],
    ['item/oak_boat.png', ['other']]
  ])('%s -> %j', (key, expected) => {
    expect(cats(key)).toEqual(expected)
  })

  it('applies to other namespaces and sends non-texture paths to the fallback', () => {
    expect(engine.categorize('assets/mymod/textures/block/foo.png')).toEqual(['blocks'])
    expect(engine.categorize('pack.png')).toEqual([FALLBACK_CATEGORY])
  })
})

describe('createCategoryEngine', () => {
  it('honours exclude, order, and adds the fallback when missing', () => {
    const engine = createCategoryEngine([
      {
        id: 'b',
        i18nKey: 'category.b',
        icon: '',
        include: ['x/**'],
        exclude: ['x/no/**'],
        order: 2
      },
      { id: 'a', i18nKey: 'category.a', icon: '', include: ['x/*.png'], order: 1 }
    ])
    expect(engine.rules.map((r) => r.id)).toEqual(['a', 'b', 'other'])
    expect(engine.categorize(tex('x/y.png'))).toEqual(['a', 'b'])
    expect(engine.categorize(tex('x/no/y.png'))).toEqual(['other'])
  })
})

describe('texture path helpers', () => {
  it('textureKey strips assets/<ns>/textures/', () => {
    expect(textureKey('assets/minecraft/textures/block/stone.png')).toBe('block/stone.png')
    expect(textureKey('assets/minecraft/models/block/stone.json')).toBeNull()
  })

  it('splitTexturePath returns namespace, folder and name', () => {
    expect(splitTexturePath('assets/minecraft/textures/gui/sprites/hud/heart/full.png')).toEqual({
      namespace: 'minecraft',
      folder: 'gui/sprites/hud/heart',
      name: 'full'
    })
    expect(splitTexturePath('assets/foo/textures/top.png')).toEqual({
      namespace: 'foo',
      folder: '',
      name: 'top'
    })
  })
})
