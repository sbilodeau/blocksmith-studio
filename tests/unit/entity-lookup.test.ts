import { describe, expect, it } from 'vitest'
import {
  entityDefinitions,
  entityFitsTexture,
  findEntityDefinition
} from '@shared/preview/entities'

const tex = (key: string): string => `assets/minecraft/textures/${key}`
const idOf = (key: string): string | undefined => findEntityDefinition(tex(key))?.id

describe('findEntityDefinition', () => {
  it('resolves zombies and their variants', () => {
    expect(idOf('entity/zombie/zombie.png')).toBe('zombie')
    expect(idOf('entity/zombie/husk.png')).toBe('zombie')
    expect(idOf('entity/zombie/drowned.png')).toBe('drowned')
    expect(idOf('entity/zombie/drowned_outer_layer.png')).toBe('drowned')
  })

  it('resolves skeletons and their clothing layers', () => {
    expect(idOf('entity/skeleton/skeleton.png')).toBe('skeleton')
    expect(idOf('entity/skeleton/stray.png')).toBe('skeleton')
    expect(idOf('entity/skeleton/stray_overlay.png')).toBe('skeleton_overlay')
  })

  it('resolves wide and slim player skins', () => {
    expect(idOf('entity/player/wide/steve.png')).toBe('player_wide')
    expect(idOf('entity/player/wide/alex.png')).toBe('player_wide')
    expect(idOf('entity/player/slim/alex.png')).toBe('player_slim')
    expect(idOf('entity/player/slim/zuri.png')).toBe('player_slim')
  })

  it('resolves armor layers', () => {
    expect(idOf('entity/equipment/humanoid/diamond.png')).toBe('humanoid_armor')
    expect(idOf('entity/equipment/humanoid_leggings/diamond.png')).toBe('humanoid_leggings')
    expect(idOf('entity/armorstand/wood.png')).toBe('armor_stand')
  })

  it('resolves wolf, cat and villager variants through globs', () => {
    expect(idOf('entity/wolf/wolf.png')).toBe('wolf')
    expect(idOf('entity/wolf/wolf_ashen_tame.png')).toBe('wolf')
    expect(idOf('entity/cat/tabby.png')).toBe('cat')
    expect(idOf('entity/cat/ocelot.png')).toBe('cat')
    expect(idOf('entity/villager/villager.png')).toBe('villager')
    expect(idOf('entity/villager/profession/farmer.png')).toBe('villager')
  })

  it('resolves the other starter entities', () => {
    expect(idOf('entity/creeper/creeper.png')).toBe('creeper')
    expect(idOf('entity/pig/pig.png')).toBe('pig')
    expect(idOf('entity/cow/cow.png')).toBe('cow')
    expect(idOf('entity/sheep/sheep.png')).toBe('sheep')
    expect(idOf('entity/sheep/sheep_fur.png')).toBe('sheep_wool')
    expect(idOf('entity/chicken.png')).toBe('chicken')
    expect(idOf('entity/spider/cave_spider.png')).toBe('spider')
    expect(idOf('entity/enderman/enderman.png')).toBe('enderman')
  })

  it('resolves villager-like mobs, piglins and illagers', () => {
    expect(idOf('entity/wandering_trader.png')).toBe('villager')
    expect(idOf('entity/wandering_trader/wandering_trader.png')).toBe('villager')
    expect(idOf('entity/zombie_villager/zombie_villager.png')).toBe('zombie_villager')
    expect(idOf('entity/zombie_villager/profession/librarian.png')).toBe('zombie_villager')
    expect(idOf('entity/zombie_villager/type/desert.png')).toBe('zombie_villager')
    expect(idOf('entity/piglin/piglin.png')).toBe('piglin')
    expect(idOf('entity/piglin/piglin_brute.png')).toBe('piglin')
    expect(idOf('entity/piglin/zombified_piglin.png')).toBe('piglin')
    expect(idOf('entity/illager/vindicator.png')).toBe('illager')
    expect(idOf('entity/illager/evoker.png')).toBe('illager')
    expect(idOf('entity/illager/illusioner.png')).toBe('illager')
    expect(idOf('entity/illager/pillager.png')).toBe('pillager')
    expect(idOf('entity/witch.png')).toBe('witch')
    expect(idOf('entity/witch/witch.png')).toBe('witch')
    expect(idOf('entity/iron_golem/iron_golem_crackiness_low.png')).toBe('iron_golem')
    expect(idOf('entity/snow_golem.png')).toBe('snow_golem')
  })

  it('resolves animals under their 1.21.4 and 26.x names', () => {
    expect(idOf('entity/fox/snow_fox.png')).toBe('fox')
    expect(idOf('entity/fox/fox_snow_sleep.png')).toBe('fox')
    expect(idOf('entity/bee/bee_angry_nectar.png')).toBe('bee')
    expect(idOf('entity/llama/creamy.png')).toBe('llama')
    expect(idOf('entity/llama/llama_creamy.png')).toBe('llama')
    expect(idOf('entity/equipment/llama_body/trader_llama.png')).toBe('llama')
    expect(idOf('entity/panda/aggressive_panda.png')).toBe('panda')
    expect(idOf('entity/panda/panda_aggressive.png')).toBe('panda')
    expect(idOf('entity/rabbit/toast.png')).toBe('rabbit')
    expect(idOf('entity/bear/polarbear.png')).toBe('polar_bear')
    expect(idOf('entity/goat/goat.png')).toBe('goat')
    expect(idOf('entity/frog/temperate_frog.png')).toBe('frog')
    expect(idOf('entity/frog/frog_warm.png')).toBe('frog')
    expect(idOf('entity/turtle/big_sea_turtle.png')).toBe('turtle')
    expect(idOf('entity/turtle/turtle.png')).toBe('turtle')
    expect(idOf('entity/dolphin.png')).toBe('dolphin')
    expect(idOf('entity/squid/glow_squid.png')).toBe('squid')
    expect(idOf('entity/hoglin/zoglin.png')).toBe('hoglin')
    expect(idOf('entity/strider/strider_cold.png')).toBe('strider')
    expect(idOf('entity/equipment/strider_saddle/saddle.png')).toBe('strider')
  })

  it('resolves monsters without legs or with odd shapes', () => {
    expect(idOf('entity/slime/slime.png')).toBe('slime')
    expect(idOf('entity/slime/magmacube.png')).toBe('magma_cube')
    expect(idOf('entity/phantom.png')).toBe('phantom')
    expect(idOf('entity/phantom/phantom_eyes.png')).toBe('phantom')
    expect(idOf('entity/bat.png')).toBe('bat')
    expect(idOf('entity/blaze/blaze.png')).toBe('blaze')
    expect(idOf('entity/shulker/shulker.png')).toBe('shulker')
    expect(idOf('entity/shulker/shulker_light_blue.png')).toBe('shulker')
  })

  it('leaves look-alike textures of other layouts flat', () => {
    expect(idOf('entity/shulker/spark.png')).toBeUndefined()
    expect(idOf('entity/llama/spit.png')).toBeUndefined()
    expect(idOf('entity/bee/bee_stinger.png')).toBeUndefined()
    expect(idOf('entity/villager/baby/plains.png')).toBeUndefined()
    expect(idOf('entity/zombie_villager/baby/plains.png')).toBeUndefined()
    expect(idOf('entity/rabbit/rabbit_brown.png')).toBeUndefined()
  })

  it('also applies to custom textures added to a covered folder', () => {
    expect(idOf('entity/wolf/wolf_custom.png')).toBe('wolf')
    expect(idOf('entity/player/wide/my_skin.png')).toBe('player_wide')
  })

  it('returns undefined for unknown entities and non-entity textures', () => {
    expect(idOf('entity/ghast/ghast.png')).toBeUndefined()
    expect(idOf('entity/wolf/wolf_baby.png')).toBeUndefined()
    expect(idOf('entity/zombie/zombie.png.mcmeta')).toBeUndefined()
    expect(idOf('block/stone.png')).toBeUndefined()
    expect(findEntityDefinition('')).toBeUndefined()
    expect(findEntityDefinition('assets/other/textures/entity/zombie/zombie.png')).toBeUndefined()
  })

  it('accepts Windows separators', () => {
    expect(findEntityDefinition('assets\\minecraft\\textures\\entity\\pig\\pig.png')?.id).toBe(
      'pig'
    )
  })

  it('returns the shared definition objects of entityDefinitions()', () => {
    expect(entityDefinitions()).toContain(findEntityDefinition(tex('entity/pig/pig.png')))
  })
})

describe('entityFitsTexture', () => {
  const wolf = findEntityDefinition('assets/minecraft/textures/entity/wolf/wolf.png')!

  it('accepts the layout size and HD multiples, rejects another aspect ratio', () => {
    expect(entityFitsTexture(wolf, 64, 32)).toBe(true)
    expect(entityFitsTexture(wolf, 128, 64)).toBe(true)
    expect(entityFitsTexture(wolf, 64, 64)).toBe(false)
    expect(entityFitsTexture(wolf, 32, 32)).toBe(false)
    expect(entityFitsTexture(wolf, 64, 48)).toBe(false)
  })
})
