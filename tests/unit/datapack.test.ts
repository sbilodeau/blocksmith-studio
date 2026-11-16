import { describe, expect, it } from 'vitest'
import {
  DATA_TEMPLATES,
  buildDataPath,
  checkDataText,
  collectDataIds,
  dataContext,
  dataTemplate,
  namespaceFor,
  parseDataPath,
  validateData,
  type DataKind
} from '@shared/datapack'

const ctx = dataContext({
  items: ['minecraft:stone', 'minecraft:diamond', 'minecraft:stick', 'minecraft:cobblestone'],
  blocks: ['minecraft:stone'],
  tags: { item: ['minecraft:planks'], block: ['minecraft:logs'] }
})

/** [severity, code, path] of each issue. */
const brief = (
  kind: DataKind,
  value: unknown,
  registry?: string
): Array<[string, string, string]> =>
  validateData(kind, value, ctx, registry).map((i) => [i.severity, i.code, i.path.join('.')])

describe('data paths', () => {
  it('parses each kind, with ids and tag registries', () => {
    expect(parseDataPath('data/minecraft/recipe/oak_planks.json')).toMatchObject({
      kind: 'recipe',
      id: 'minecraft:oak_planks',
      namespace: 'minecraft',
      name: 'oak_planks',
      text: false
    })
    expect(parseDataPath('data/minecraft/loot_table/blocks/stone.json')).toMatchObject({
      kind: 'loot_table',
      id: 'minecraft:blocks/stone'
    })
    expect(parseDataPath('data/my_pack/tags/item/gems/red.json')).toMatchObject({
      kind: 'tag',
      registry: 'item',
      id: 'my_pack:gems/red'
    })
    expect(parseDataPath('data/minecraft/tags/worldgen/biome/is_ocean.json')).toMatchObject({
      kind: 'tag',
      registry: 'worldgen/biome',
      id: 'minecraft:is_ocean'
    })
    expect(parseDataPath('data/my_pack/function/start.mcfunction')).toMatchObject({
      kind: 'function',
      id: 'my_pack:start',
      text: true
    })
    expect(parseDataPath('data/minecraft/worldgen/biome/plains.json')).toMatchObject({
      kind: 'other',
      id: 'minecraft:worldgen/biome/plains'
    })
  })

  it('rejects other files, unsafe and invalid names', () => {
    for (const bad of [
      'assets/minecraft/recipe/x.json',
      'data/minecraft/recipe/X.json',
      'data/minecraft/recipe/../x.json',
      'data/minecraft/recipe//x.json',
      'data/minecraft/structure/igloo.nbt',
      'data/Mine/recipe/x.json',
      'data/minecraft/recipe/a b.json'
    ]) {
      expect(parseDataPath(bad), bad).toBeNull()
    }
  })

  it('builds paths for new files', () => {
    expect(buildDataPath('recipe', 'my_pack', 'ruby_block')).toBe(
      'data/my_pack/recipe/ruby_block.json'
    )
    expect(buildDataPath('tag', 'my_pack', 'gems', 'block')).toBe(
      'data/my_pack/tags/block/gems.json'
    )
    expect(buildDataPath('function', 'my_pack', 'setup/start')).toBe(
      'data/my_pack/function/setup/start.mcfunction'
    )
    expect(buildDataPath('other', 'my_pack', 'predicate/is_day')).toBe(
      'data/my_pack/predicate/is_day.json'
    )
    expect(buildDataPath('recipe', 'my_pack', 'Ruby Block')).toBeNull()
    expect(buildDataPath('recipe', 'my pack', 'ruby')).toBeNull()
    expect(buildDataPath('recipe', 'my_pack', '../x')).toBeNull()
  })

  it('makes a namespace from the pack name', () => {
    expect(namespaceFor('Fire Pack!')).toBe('fire_pack')
    expect(namespaceFor('Été chaud')).toBe('ete_chaud')
    expect(namespaceFor('Minecraft')).toBe('my_pack')
    expect(namespaceFor('!!!')).toBe('my_pack')
  })
})

describe('recipe checks', () => {
  const shaped = {
    type: 'minecraft:crafting_shaped',
    pattern: ['##', '#S'],
    key: { '#': 'minecraft:cobblestone', S: '#minecraft:planks' },
    result: { id: 'minecraft:stone', count: 2 }
  }

  it('accepts a valid shaped recipe (namespace may be left out)', () => {
    expect(brief('recipe', shaped)).toEqual([])
    expect(brief('recipe', { ...shaped, type: 'crafting_shaped' })).toEqual([])
  })

  it('checks the pattern against the key, as Minecraft does', () => {
    expect(brief('recipe', { ...shaped, pattern: ['##X', '#'], key: { ...shaped.key } })).toEqual([
      ['error', 'patternWidth', 'pattern'],
      ['error', 'keyUnused', 'key.S'],
      ['error', 'keyMissing', 'pattern']
    ])
    expect(brief('recipe', { ...shaped, key: { ...shaped.key, AB: 'minecraft:stick' } })).toEqual([
      ['error', 'keyLength', 'key.AB']
    ])
    expect(brief('recipe', { ...shaped, pattern: ['####'] })).toEqual([
      ['error', 'tooLong', 'pattern.0'],
      ['error', 'keyUnused', 'key.S']
    ])
  })

  it('reports missing fields, wrong types and bad ids', () => {
    expect(brief('recipe', { type: 'minecraft:crafting_shapeless', ingredients: [] })).toEqual([
      ['error', 'tooFewItems', 'ingredients'],
      ['error', 'required', 'result']
    ])
    expect(
      brief('recipe', {
        type: 'minecraft:smelting',
        ingredient: { item: 'minecraft:stone' },
        result: { id: 'Minecraft:Stone' },
        cookingtime: 1.5
      })
    ).toEqual([
      ['error', 'ingredient', 'ingredient'],
      ['error', 'id', 'result.id'],
      ['error', 'type', 'cookingtime']
    ])
    expect(
      brief('recipe', {
        type: 'minecraft:stonecutting',
        ingredient: ['#minecraft:planks'],
        result: { id: 'minecraft:stone' }
      })
    ).toEqual([['error', 'ingredientListItem', 'ingredient.0']])
    expect(brief('recipe', {})).toEqual([['error', 'required', 'type']])
    expect(brief('recipe', [])).toEqual([['error', 'notObject', '']])
  })

  it('warns about unknown items, tags and recipe types, but not other namespaces', () => {
    expect(
      brief('recipe', {
        type: 'minecraft:crafting_shapeless',
        ingredients: ['minecraft:rubyy', '#minecraft:nope', 'othermod:gem'],
        result: { id: 'minecraft:diamond' }
      })
    ).toEqual([
      ['warning', 'unknownItem', 'ingredients.0'],
      ['warning', 'unknownTag', 'ingredients.1']
    ])
    expect(brief('recipe', { type: 'minecraft:crafting_magic' })).toEqual([
      ['warning', 'unknownRecipeType', 'type']
    ])
    expect(brief('recipe', { type: 'othermod:machine' })).toEqual([])
    // Without id lists (vanilla not extracted) nothing is unknown.
    expect(
      validateData('recipe', {
        type: 'minecraft:crafting_shapeless',
        ingredients: ['minecraft:x'],
        result: { id: 'minecraft:y' }
      })
    ).toEqual([])
  })

  it('accepts both transmute result forms (1.21.4 id, 1.21.5+ stack, possibly empty)', () => {
    const base = {
      type: 'minecraft:crafting_transmute',
      input: '#minecraft:planks',
      material: 'minecraft:stick'
    }
    expect(brief('recipe', { ...base, result: 'minecraft:stone' })).toEqual([])
    expect(brief('recipe', { ...base, result: { id: 'minecraft:stone' } })).toEqual([])
    expect(brief('recipe', { ...base, result: {} })).toEqual([])
    expect(brief('recipe', { ...base, result: 3 })).toEqual([['error', 'itemStack', 'result']])
  })
})

describe('loot table, tag and advancement checks', () => {
  it('loot tables: pools need rolls and entries; entries need their field', () => {
    expect(
      brief('loot_table', {
        type: 'minecraft:block',
        pools: [
          {
            rolls: { type: 'minecraft:uniform', min: 1, max: 2 },
            entries: [
              { type: 'minecraft:item', name: 'minecraft:stone', weight: 2 },
              { type: 'minecraft:alternatives', children: [{ type: 'minecraft:item' }] },
              { type: 'minecraft:loot_table', value: 'minecraft:blocks/stone' },
              { type: 'minecraft:tag', items: '#minecraft:planks', expand: true },
              { type: 'minecraft:item', name: 'minecraft:rubyy', weight: 0 }
            ]
          },
          { entries: [] }
        ]
      })
    ).toEqual([
      ['error', 'required', 'pools.0.entries.1.children.0.name'],
      ['error', 'tooSmall', 'pools.0.entries.4.weight'],
      ['error', 'required', 'pools.1.rolls'],
      ['warning', 'unknownItem', 'pools.0.entries.4.name']
    ])
  })

  it('tags: values are ids, tags or {id, required}; unknown ids only when required', () => {
    expect(
      brief(
        'tag',
        {
          replace: false,
          values: [
            'minecraft:stone',
            '#minecraft:logs',
            { id: 'minecraft:nope', required: false },
            'minecraft:nope',
            3
          ]
        },
        'block'
      )
    ).toEqual([
      ['error', 'tagValue', 'values.4'],
      ['warning', 'unknownBlock', 'values.3']
    ])
    expect(brief('tag', { values: [{ required: true }] }, 'item')).toEqual([
      ['error', 'required', 'values.0.id']
    ])
    // Other registries are not checked against items or blocks.
    expect(brief('tag', { values: ['minecraft:zombie'] }, 'entity_type')).toEqual([])
  })

  it('advancements: criteria required, requirements must name them', () => {
    const criteria = { got: { trigger: 'minecraft:inventory_changed' } }
    expect(
      brief('advancement', {
        criteria,
        requirements: [['got', 'missing']],
        display: { icon: { id: 'minecraft:rubyy' }, title: 'T', description: { text: 'D' } }
      })
    ).toEqual([
      ['error', 'unknownCriterion', 'requirements.0.1'],
      ['warning', 'unknownItem', 'display.icon.id']
    ])
    expect(
      brief('advancement', {
        criteria,
        display: { icon: { id: 'minecraft:stone' }, title: 'T', description: 'D', frame: 'boss' }
      })
    ).toEqual([['error', 'value', 'display.frame']])
    expect(brief('advancement', { criteria: {} })).toEqual([['error', 'noCriteria', 'criteria']])
    expect(brief('advancement', {})).toEqual([['error', 'required', 'criteria']])
  })

  it('functions and other JSON files have no schema', () => {
    expect(brief('function', 'say hi')).toEqual([])
    expect(brief('other', { anything: true })).toEqual([])
  })
})

describe('checkDataText', () => {
  it('places schema issues in the text', () => {
    const text =
      '{\n  "type": "minecraft:smelting",\n  "ingredient": 5,\n  "result": {"id": "minecraft:stone"}\n}\n'
    const r = checkDataText(text, 'recipe', ctx)
    expect(r.errors).toBe(1)
    const issue = r.issues[0]!
    expect(issue.code).toBe('ingredient')
    expect(text.slice(issue.from, issue.to)).toBe('5')
    // A missing key marks the key of its parent object (or the object's first character).
    const missing = checkDataText(
      '{"type": "minecraft:smelting", "result": {"id": "minecraft:stone"}}',
      'recipe',
      ctx
    )
    expect(missing.issues[0]).toMatchObject({
      code: 'required',
      params: { key: 'ingredient' },
      from: 0,
      to: 1
    })
  })

  it('reports syntax errors strictly (no comments, no trailing commas)', () => {
    const r = checkDataText('{"values": ["minecraft:stone",]}', 'tag', ctx, 'block')
    expect(r.value).toBeUndefined()
    expect(r.issues[0]).toMatchObject({ code: 'syntax', params: { error: 'valueExpected' } })
    expect(checkDataText('// hi\n{"values": []}', 'tag').issues[0]!.params).toEqual({
      error: 'invalidCommentToken'
    })
    expect(checkDataText('', 'tag').errors).toBe(1)
    expect(checkDataText('not json', 'function').errors).toBe(0)
  })
})

describe('templates and ids', () => {
  it('every template is valid for its kind', () => {
    for (const [kind, templates] of Object.entries(DATA_TEMPLATES) as Array<
      [DataKind, readonly string[]]
    >) {
      for (const template of templates) {
        const text = dataTemplate(template as never, 'my_pack:thing')
        expect(checkDataText(text, kind, {}, 'item').errors, `${kind}/${template}`).toBe(0)
      }
    }
    // A vanilla override starts from the item of the same name.
    expect(
      JSON.parse(dataTemplate('block', 'minecraft:blocks/oak_log')).pools[0].entries[0].name
    ).toBe('minecraft:oak_log')
  })

  it('collects items, blocks and tags from file paths', () => {
    const ids = collectDataIds([
      'assets/minecraft/items/stone.json',
      'assets/minecraft/blockstates/stone.json',
      'assets/minecraft/textures/block/stone.png',
      'data/minecraft/tags/item/planks.json',
      'data/my_pack/tags/block/gems.json',
      'data/minecraft/recipe/stone.json'
    ])
    expect(ids).toEqual({
      items: ['minecraft:stone'],
      blocks: ['minecraft:stone'],
      tags: { item: ['minecraft:planks'], block: ['my_pack:gems'] }
    })
    expect(dataContext({ items: [], blocks: [], tags: {} })).toEqual({})
  })
})
