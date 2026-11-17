import type { DataKind } from './paths'
import { formatJson } from './text'

/**
 * Starting content for new data files. Each template is valid in every version of the support window (1.21.4 ->
 * 26.3): loot tables avoid conditions and functions, whose format changed in 26.1.
 */
export const DATA_TEMPLATES = {
  recipe: ['shaped', 'shapeless', 'smelting', 'stonecutting', 'smithing'],
  loot_table: ['block', 'chest', 'entity'],
  tag: ['tag'],
  advancement: ['advancement'],
  function: ['function'],
  other: ['empty']
} as const satisfies Record<DataKind, readonly string[]>

export type DataTemplate = (typeof DATA_TEMPLATES)[DataKind][number]

/**
 * Text of a new file. `id` is the file's own resource location ("my_pack:ruby_block"); templates use it as the
 * crafted item, dropped item, advancement criterion... so the file is ready to adjust.
 */
export function dataTemplate(template: DataTemplate, id: string): string {
  // Data packs cannot add items: a file in the pack's own namespace starts from a diamond; a vanilla override
  // ("minecraft:blocks/oak_log") from the item of the same name.
  const item = id.startsWith('minecraft:')
    ? `minecraft:${id.slice(id.lastIndexOf('/') + 1).replace(/^minecraft:/, '')}`
    : 'minecraft:diamond'
  switch (template) {
    case 'shaped':
      return formatJson({
        type: 'minecraft:crafting_shaped',
        category: 'misc',
        pattern: ['###', '#X#', '###'],
        key: { '#': 'minecraft:cobblestone', X: 'minecraft:diamond' },
        result: { id: item, count: 1 }
      })
    case 'shapeless':
      return formatJson({
        type: 'minecraft:crafting_shapeless',
        category: 'misc',
        ingredients: ['minecraft:diamond', '#minecraft:planks'],
        result: { id: item, count: 1 }
      })
    case 'smelting':
      return formatJson({
        type: 'minecraft:smelting',
        category: 'misc',
        ingredient: 'minecraft:cobblestone',
        result: { id: item },
        experience: 0.1,
        cookingtime: 200
      })
    case 'stonecutting':
      return formatJson({
        type: 'minecraft:stonecutting',
        ingredient: 'minecraft:stone',
        result: { id: item, count: 2 }
      })
    case 'smithing':
      return formatJson({
        type: 'minecraft:smithing_transform',
        template: 'minecraft:netherite_upgrade_smithing_template',
        base: 'minecraft:diamond_sword',
        addition: 'minecraft:netherite_ingot',
        result: { id: item }
      })
    case 'block':
      return formatJson({
        type: 'minecraft:block',
        pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: item }] }]
      })
    case 'chest':
      return formatJson({
        type: 'minecraft:chest',
        pools: [
          {
            rolls: 3,
            entries: [
              { type: 'minecraft:item', name: 'minecraft:diamond', weight: 1 },
              { type: 'minecraft:item', name: 'minecraft:iron_ingot', weight: 5 },
              { type: 'minecraft:empty', weight: 10 }
            ]
          }
        ]
      })
    case 'entity':
      return formatJson({
        type: 'minecraft:entity',
        pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'minecraft:bone' }] }]
      })
    case 'tag':
      return formatJson({ values: [] })
    case 'advancement':
      return formatJson({
        criteria: {
          has_item: {
            trigger: 'minecraft:inventory_changed',
            conditions: { items: [{ items: 'minecraft:diamond' }] }
          }
        },
        display: {
          icon: { id: 'minecraft:diamond' },
          title: 'New advancement',
          description: 'Get a diamond'
        },
        parent: 'minecraft:story/root',
        requirements: [['has_item']]
      })
    case 'function':
      return '# Runs with /function ' + id + '\nsay Hello from ' + id + '\n'
    case 'empty':
      return formatJson({})
  }
}
