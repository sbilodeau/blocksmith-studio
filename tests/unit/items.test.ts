import { describe, expect, it } from 'vitest'
import {
  CustomItemSchema,
  LATEST_ITEM_FORMAT,
  checkItems,
  exportItemFiles,
  functionCommand,
  generateItemFiles,
  giveCommand,
  itemChanges,
  itemComponents,
  itemFormatFor,
  itemIdFromName,
  itemPreset,
  itemTagsFrom,
  parseItem,
  recipesUsing,
  toSnbt,
  type CustomItem,
  type CustomItemInput,
  type ItemFormat
} from '@shared/items'
import { findVersion, versionTable } from '@shared/versions'

const format = (id: string): ItemFormat => itemFormatFor(findVersion(versionTable, id)!)
const OLD = format('1.21.4')
const NEW = format('26.3')

function item(
  patch: Partial<CustomItemInput> = {},
  preset: Partial<CustomItemInput> = itemPreset('weapon').item
): CustomItem {
  return CustomItemSchema.parse({
    schemaVersion: 1,
    id: 'ruby_sword',
    namespace: 'gems',
    names: { en_us: 'Ruby Sword', fr_fr: 'Épée en rubis' },
    ...preset,
    ...patch
  })
}

const files = (it: CustomItem, f = NEW): Record<string, string> =>
  Object.fromEntries(generateItemFiles(it, f).map((x) => [x.path, x.text]))

describe('item formats', () => {
  it('switches text and attribute modifiers at 1.21.5', () => {
    expect(format('1.21.4')).toEqual({ textAsObject: false, modifiersAsList: false })
    expect(format('1.21.5')).toEqual({ textAsObject: true, modifiersAsList: true })
    expect(format('26.3')).toEqual(LATEST_ITEM_FORMAT)
    expect(format('26.4-snapshot-8')).toEqual(LATEST_ITEM_FORMAT)
  })
})

describe('item schema', () => {
  it('fills defaults and requires the block of the kind', () => {
    const sword = item()
    expect(sword).toMatchObject({ kind: 'weapon', base: 'minecraft:stone_sword', handheld: true })
    expect(sword.lore).toEqual([])
    expect(sword.recipe).toBeNull()
    expect(CustomItemSchema.safeParse({ ...sword, weapon: undefined }).success).toBe(false)
    expect(CustomItemSchema.safeParse({ ...sword, names: { fr_fr: 'Épée' } }).success).toBe(false)
    expect(CustomItemSchema.safeParse({ ...sword, namespace: 'minecraft' }).success).toBe(false)
    expect(CustomItemSchema.safeParse({ ...sword, id: 'a/b' }).success).toBe(false)
    expect(CustomItemSchema.safeParse({ ...sword, maxStack: 16 }).success).toBe(false)
  })

  it('builds ids from names and parses files', () => {
    expect(itemIdFromName('Épée en Rubis !')).toBe('epee_en_rubis')
    expect(parseItem('{')).toBeNull()
    expect(parseItem(JSON.stringify(item()))).toEqual(item())
  })
})

describe('item components', () => {
  it('writes a weapon for 26.3', () => {
    expect(itemComponents(item(), NEW)).toEqual({
      'minecraft:item_model': 'gems:ruby_sword',
      'minecraft:item_name': { translate: 'item.gems.ruby_sword', fallback: 'Ruby Sword' },
      'minecraft:max_damage': 1561,
      'minecraft:max_stack_size': 1,
      'minecraft:attribute_modifiers': [
        {
          type: 'minecraft:attack_damage',
          id: 'minecraft:base_attack_damage',
          amount: 6,
          operation: 'add_value',
          slot: 'mainhand'
        },
        {
          type: 'minecraft:attack_speed',
          id: 'minecraft:base_attack_speed',
          amount: -2.4,
          operation: 'add_value',
          slot: 'mainhand'
        }
      ]
    })
  })

  it('writes text as JSON strings and modifiers in the full form for 1.21.4', () => {
    const c = itemComponents(item({ lore: [{ en_us: 'Shiny' }] }), OLD)
    expect(c['minecraft:item_name']).toBe(
      '{"translate":"item.gems.ruby_sword","fallback":"Ruby Sword"}'
    )
    expect(c['minecraft:lore']).toEqual([
      '{"translate":"item.gems.ruby_sword.lore.1","fallback":"Shiny","color":"gray","italic":false}'
    ])
    expect(c['minecraft:attribute_modifiers']).toMatchObject({ show_in_tooltip: true })
  })

  it('writes food, effects and removals', () => {
    const apple = item(
      {
        id: 'magic_apple',
        names: { en_us: 'Magic Apple' },
        food: {
          nutrition: 4,
          saturation: 9.6,
          animation: 'eat',
          effects: [{ effect: 'minecraft:night_vision', seconds: 30, level: 2, chance: 0.5 }]
        }
      },
      itemPreset('food').item
    )
    const c = itemComponents(apple, NEW)
    expect(c['minecraft:food']).toEqual({ nutrition: 4, saturation: 9.6, can_always_eat: false })
    expect(c['minecraft:consumable']).toEqual({
      consume_seconds: 1.6,
      animation: 'eat',
      sound: 'minecraft:entity.generic.eat',
      has_consume_particles: true,
      on_consume_effects: [
        {
          type: 'minecraft:apply_effects',
          effects: [{ id: 'minecraft:night_vision', amplifier: 1, duration: 600 }],
          probability: 0.5
        }
      ]
    })
    const gem = item({ id: 'ruby', names: { en_us: 'Ruby' } }, itemPreset('simple').item)
    const g = itemComponents(gem, NEW)
    expect(g['!minecraft:food']).toEqual({})
    expect(g['!minecraft:consumable']).toEqual({})
    expect(g['minecraft:max_stack_size']).toBe(64)
  })

  it('writes tools and armor', () => {
    const pick = item({ id: 'ruby_pickaxe' }, itemPreset('tool', 'pickaxe').item)
    expect(itemComponents(pick, NEW)['minecraft:tool']).toEqual({
      rules: [
        { blocks: '#minecraft:incorrect_for_diamond_tool', correct_for_drops: false },
        { blocks: '#minecraft:mineable/pickaxe', correct_for_drops: true, speed: 8 }
      ],
      damage_per_block: 1
    })
    const helmet = item({ id: 'ruby_helmet' }, itemPreset('armor', 'head').item)
    const c = itemComponents(helmet, NEW)
    expect(c['minecraft:equippable']).toEqual({ slot: 'head', asset_id: 'gems:ruby_helmet' })
    expect(c['minecraft:attribute_modifiers']).toEqual([
      {
        type: 'minecraft:armor',
        id: 'minecraft:armor.helmet',
        amount: 3,
        operation: 'add_value',
        slot: 'head'
      },
      {
        type: 'minecraft:armor_toughness',
        id: 'minecraft:armor.helmet',
        amount: 2,
        operation: 'add_value',
        slot: 'head'
      }
    ])
  })

  it('lets extra components win over generated ones', () => {
    const c = itemComponents(
      item({ extraComponents: { 'minecraft:max_stack_size': 2, '!minecraft:max_damage': {} } }),
      NEW
    )
    expect(c['minecraft:max_stack_size']).toBe(2)
    expect(c['!minecraft:max_damage']).toEqual({})
    expect(c['minecraft:max_damage']).toBeUndefined()
  })
})

describe('generated files', () => {
  it('writes the model chain, recipe and give function', () => {
    const sword = item({
      recipe: {
        type: 'shaped',
        grid: [
          null,
          'minecraft:redstone',
          null,
          null,
          'minecraft:redstone',
          null,
          null,
          'minecraft:stick',
          null
        ]
      }
    })
    const f = files(sword)
    expect(Object.keys(f)).toEqual([
      'assets/gems/items/ruby_sword.json',
      'assets/gems/models/item/ruby_sword.json',
      'data/gems/recipe/ruby_sword.json',
      'data/gems/function/give/ruby_sword.mcfunction'
    ])
    expect(JSON.parse(f['assets/gems/items/ruby_sword.json']!)).toEqual({
      model: { type: 'minecraft:model', model: 'gems:item/ruby_sword' }
    })
    expect(JSON.parse(f['assets/gems/models/item/ruby_sword.json']!)).toEqual({
      parent: 'minecraft:item/handheld',
      textures: { layer0: 'gems:item/ruby_sword' }
    })
    const recipe = JSON.parse(f['data/gems/recipe/ruby_sword.json']!)
    expect(recipe).toMatchObject({
      type: 'minecraft:crafting_shaped',
      category: 'equipment',
      pattern: ['A', 'A', 'B'],
      key: { A: 'minecraft:redstone', B: 'minecraft:stick' },
      result: { id: 'minecraft:stone_sword', count: 1 }
    })
    expect(recipe.result.components['minecraft:item_model']).toBe('gems:ruby_sword')
  })

  it('writes armor equipment and shapeless recipes', () => {
    const legs = item(
      {
        id: 'ruby_leggings',
        recipe: {
          type: 'shapeless',
          ingredients: ['minecraft:diamond', '#minecraft:planks'],
          count: 2
        }
      },
      itemPreset('armor', 'legs').item
    )
    const f = files(legs)
    expect(JSON.parse(f['assets/gems/equipment/ruby_leggings.json']!)).toEqual({
      layers: { humanoid_leggings: [{ texture: 'gems:ruby_leggings' }] }
    })
    expect(JSON.parse(f['data/gems/recipe/ruby_leggings.json']!)).toMatchObject({
      type: 'minecraft:crafting_shapeless',
      ingredients: ['minecraft:diamond', '#minecraft:planks'],
      result: { count: 2 }
    })
  })

  it('writes SNBT give commands for both formats', () => {
    const sword = item({ durability: undefined, weapon: { attackDamage: 9, attackSpeed: 1.6 } })
    expect(giveCommand(sword, NEW)).toBe(
      '/give @s minecraft:stone_sword[minecraft:item_model="gems:ruby_sword",' +
        'minecraft:item_name={translate:"item.gems.ruby_sword",fallback:"Ruby Sword"},' +
        'minecraft:attribute_modifiers=[{type:"minecraft:attack_damage",id:"minecraft:base_attack_damage",amount:8,operation:"add_value",slot:"mainhand"},' +
        '{type:"minecraft:attack_speed",id:"minecraft:base_attack_speed",amount:-2.4,operation:"add_value",slot:"mainhand"}]]'
    )
    expect(giveCommand(sword, OLD)).toContain(
      `minecraft:item_name='{"translate":"item.gems.ruby_sword","fallback":"Ruby Sword"}'`
    )
    expect(giveCommand(sword, OLD)).toContain('show_in_tooltip:true')
    const gem = item({ id: 'ruby' }, itemPreset('simple').item)
    expect(giveCommand(gem, NEW)).toContain(',!minecraft:food,!minecraft:consumable]')
    expect(functionCommand(gem)).toBe('/function gems:give/ruby')
    expect(toSnbt({ 'a b': 'it\'s "x"' })).toBe('{"a b":"it\'s \\"x\\""}')
  })
})

describe('item changes', () => {
  const lang = (store: Record<string, Record<string, string>>) => (path: string) =>
    store[path] ?? null

  it('creates the definition, generated files and names', () => {
    const changes = itemChanges({
      before: null,
      after: item(),
      others: [],
      format: NEW,
      readLang: lang({})
    })
    const paths = changes.map((c) => c.path).sort()
    expect(paths).toEqual([
      'assets/gems/items/ruby_sword.json',
      'assets/gems/lang/en_us.json',
      'assets/gems/lang/fr_fr.json',
      'assets/gems/models/item/ruby_sword.json',
      'blocksmith/items/ruby_sword.json',
      'data/gems/function/give/ruby_sword.mcfunction'
    ])
    const fr = changes.find((c) => c.path === 'assets/gems/lang/fr_fr.json')!
    expect(JSON.parse(fr.text!)).toEqual({ 'item.gems.ruby_sword': 'Épée en rubis' })
  })

  it('renames: old files removed, other lang keys kept', () => {
    const before = item({ recipe: { type: 'shapeless', ingredients: ['minecraft:diamond'] } })
    const after = item({ id: 'ruby_blade', recipe: null })
    const store = {
      'assets/gems/lang/en_us.json': {
        'item.gems.ruby_sword': 'Ruby Sword',
        'item.gems.other': 'Other'
      },
      'assets/gems/lang/fr_fr.json': { 'item.gems.ruby_sword': 'Épée en rubis' }
    }
    const changes = Object.fromEntries(
      itemChanges({ before, after, others: [before], format: NEW, readLang: lang(store) }).map(
        (c) => [c.path, c.text]
      )
    )
    expect(changes['blocksmith/items/ruby_sword.json']).toBeNull()
    expect(changes['data/gems/recipe/ruby_sword.json']).toBeNull()
    expect(changes['assets/gems/models/item/ruby_sword.json']).toBeNull()
    expect(changes['assets/gems/models/item/ruby_blade.json']).toBeTruthy()
    expect(JSON.parse(changes['assets/gems/lang/en_us.json']!)).toEqual({
      'item.gems.other': 'Other',
      'item.gems.ruby_blade': 'Ruby Sword'
    })
  })

  it('deletes: lang file emptied is removed', () => {
    const before = item({ names: { en_us: 'Ruby Sword' } })
    const store = { 'assets/gems/lang/en_us.json': { 'item.gems.ruby_sword': 'Ruby Sword' } }
    const changes = itemChanges({
      before,
      after: null,
      others: [],
      format: NEW,
      readLang: lang(store)
    })
    expect(changes.every((c) => c.text === null)).toBe(true)
    expect(changes.map((c) => c.path)).toContain('assets/gems/lang/en_us.json')
  })
})

describe('export and checks', () => {
  const enc = new TextEncoder()
  const dec = new TextDecoder()

  it('regenerates for the target version and leaves blocksmith/ out', () => {
    const sword = item()
    const pack = [
      { path: 'blocksmith/items/ruby_sword.json', data: enc.encode(JSON.stringify(sword)) },
      { path: 'blocksmith/items/broken.json', data: enc.encode('{') },
      ...generateItemFiles(sword, NEW).map((f) => ({ path: f.path, data: enc.encode(f.text) }))
    ]
    const out = exportItemFiles(pack, OLD)
    expect(out.invalid).toEqual(['blocksmith/items/broken.json'])
    const paths = out.files.map((f) => f.path)
    expect(paths.some((p) => p.startsWith('blocksmith/'))).toBe(false)
    expect(paths).toContain('assets/gems/lang/fr_fr.json')
    const give = dec.decode(out.files.find((f) => f.path.endsWith('.mcfunction'))!.data)
    expect(give).toContain('show_in_tooltip:true')
  })

  it('reports missing, edited and stale files', () => {
    const sword = item({ recipe: { type: 'shapeless', ingredients: ['minecraft:nope'] } })
    const text: Record<string, string> = {
      'blocksmith/items/ruby_sword.json': JSON.stringify(sword),
      'blocksmith/items/bad.json': '{}',
      'assets/gems/items/ruby_sword.json': generateItemFiles(sword, NEW)[0]!.text.replace(
        /\n/g,
        '\r\n'
      ),
      'assets/gems/models/item/ruby_sword.json': '{}',
      'assets/gems/lang/en_us.json': '{"item.gems.ruby_sword":"Ruby Sword"}'
    }
    const issues = checkItems({
      paths: new Set(Object.keys(text)),
      read: (p) => text[p] ?? null,
      format: NEW,
      vanillaItems: new Set(['minecraft:diamond'])
    })
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['items.invalidDefinition', 'blocksmith/items/bad.json'],
      ['items.missingTexture', 'assets/gems/textures/item/ruby_sword.png'],
      ['items.unknownBase', 'blocksmith/items/ruby_sword.json'],
      ['items.unknownIngredient', 'blocksmith/items/ruby_sword.json'],
      ['items.generatedEdited', 'assets/gems/models/item/ruby_sword.json'],
      ['items.generatedMissing', 'data/gems/recipe/ruby_sword.json'],
      ['items.generatedMissing', 'data/gems/function/give/ruby_sword.mcfunction'],
      ['items.langOutdated', 'assets/gems/lang/fr_fr.json']
    ])
  })
})

describe('recipe uses', () => {
  it('finds direct and tag uses, not results', () => {
    const tags = itemTagsFrom([
      { path: 'data/minecraft/tags/item/fruits.json', json: { values: ['minecraft:apple'] } },
      { path: 'data/minecraft/tags/item/food.json', json: { values: ['#minecraft:fruits'] } }
    ])
    const recipes = [
      {
        path: 'data/minecraft/recipe/golden_apple.json',
        json: { key: { A: 'minecraft:apple' }, result: { id: 'minecraft:golden_apple' } }
      },
      {
        path: 'data/minecraft/recipe/salad.json',
        json: { ingredients: ['#minecraft:food'], result: { id: 'x:y' } }
      },
      {
        path: 'data/minecraft/recipe/apple.json',
        json: { ingredients: ['minecraft:stick'], result: { id: 'minecraft:apple' } }
      }
    ]
    expect(recipesUsing('minecraft:apple', recipes, tags)).toEqual([
      'minecraft:golden_apple',
      'minecraft:salad'
    ])
  })
})
