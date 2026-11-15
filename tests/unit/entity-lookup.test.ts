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

  it('also applies to custom textures added to a covered folder', () => {
    expect(idOf('entity/wolf/wolf_custom.png')).toBe('wolf')
    expect(idOf('entity/player/wide/my_skin.png')).toBe('player_wide')
  })

  it('returns undefined for unknown entities and non-entity textures', () => {
    expect(idOf('entity/llama/creamy.png')).toBeUndefined()
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
