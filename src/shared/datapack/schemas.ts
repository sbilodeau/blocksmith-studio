import { z } from 'zod'
import type { DataKind } from './paths'

/**
 * Data file checks (PLAN M10). Each validated kind has a zod schema written by hand from the Minecraft wiki and checked
 * against every vanilla file of the support window (tests/real-jar/datapack-schemas.test.ts): a vanilla file must give
 * no issue at all.
 *
 * The formats change between versions (26.1 renamed loot table "conditions" to "condition" and "functions" to
 * "modifier", 1.21.5 changed the transmute result...), so the schemas check the parts every supported version shares
 * strictly and let the rest through: extra fields are allowed everywhere, conditions and functions are not checked,
 * and a recipe type the app does not know is only a warning.
 *
 * Issues carry an i18n code (`data.issue.<code>`) and a JSON path; text.ts turns the path into a range in the editor.
 */

export interface DataIssue {
  severity: 'error' | 'warning'
  /** i18n key under `data.issue.*`. */
  code: string
  params?: Record<string, string | number>
  /** JSON path of the value at fault ([] = the whole document). */
  path: Array<string | number>
}

/** Ids the game knows, for "unknown item" warnings (minecraft namespace only; other namespaces may be mods). */
export interface DataContext {
  items?: ReadonlySet<string>
  blocks?: ReadonlySet<string>
  /** Tag ids per registry, without "#": { item: Set(["minecraft:planks", ...]), block: ... }. */
  tags?: Readonly<Record<string, ReadonlySet<string>>>
}

const RESOURCE_ID = /^(?:[a-z0-9_.-]+:)?[a-z0-9_.\-/]+$/

/** "stone" -> "minecraft:stone"; ids are compared in their full form. */
export function fullId(id: string): string {
  return id.includes(':') ? id : `minecraft:${id}`
}

type Ctx = z.core.$RefinementCtx<unknown>

function custom(
  ctx: Ctx,
  code: string,
  params?: Record<string, string | number>,
  path?: Array<string | number>
): void {
  ctx.addIssue({
    code: 'custom',
    message: code,
    params: { code, ...params },
    ...(path ? { path } : {})
  })
}

function checkId(value: unknown, ctx: Ctx, allowTag: boolean, path?: Array<string | number>): void {
  if (typeof value !== 'string') {
    custom(ctx, 'type', { expected: 'string' }, path)
    return
  }
  const id = allowTag && value.startsWith('#') ? value.slice(1) : value
  if (!RESOURCE_ID.test(id)) custom(ctx, allowTag ? 'idOrTag' : 'id', { value }, path)
}

/** A resource location: "minecraft:stone" or "stone". */
const Id = z.unknown().superRefine((v, ctx) => checkId(v, ctx, false))

/**
 * Recipe ingredient (1.21.2+): an item id, a tag "#ns:tag", or a non-empty list of item ids. Older object forms
 * ({"item": ...}) are not valid in any supported version.
 */
const Ingredient = z.unknown().superRefine((v, ctx) => {
  if (typeof v === 'string') return checkId(v, ctx, true)
  if (Array.isArray(v)) {
    if (v.length === 0) return custom(ctx, 'ingredientEmpty')
    v.forEach((item, i) => {
      if (typeof item !== 'string' || item.startsWith('#') || !RESOURCE_ID.test(item)) {
        custom(ctx, 'ingredientListItem', { value: String(item) }, [i])
      }
    })
    return
  }
  custom(ctx, 'ingredient')
})

/** An item stack: {"id": "minecraft:stone", "count": 2, "components": {...}}. */
const ItemStack = z.looseObject({
  id: Id,
  count: z.number().int().min(1).max(99).optional(),
  components: z.record(z.string(), z.unknown()).optional()
})

/** Text component: a string, an object or a list of components. */
const TextComponent = z.unknown().superRefine((v, ctx) => {
  if (typeof v === 'string' || Array.isArray(v) || (typeof v === 'object' && v !== null)) return
  custom(ctx, 'textComponent')
})

const RecipeCommon = {
  type: z.string(),
  group: z.string().optional(),
  category: z.string().optional(),
  show_notification: z.boolean().optional()
}

const Shaped = z
  .looseObject({
    ...RecipeCommon,
    pattern: z.array(z.string().min(1).max(3)).min(1).max(3),
    key: z.record(z.string(), Ingredient),
    result: ItemStack
  })
  .superRefine((r, ctx) => {
    const widths = new Set(r.pattern.map((row) => row.length))
    if (widths.size > 1) custom(ctx, 'patternWidth', {}, ['pattern'])
    const used = new Set(r.pattern.join('').replace(/ /g, ''))
    for (const key of Object.keys(r.key)) {
      if (key.length !== 1) custom(ctx, 'keyLength', { key }, ['key', key])
      else if (key === ' ') custom(ctx, 'keySpace', {}, ['key', key])
      else if (!used.has(key)) custom(ctx, 'keyUnused', { key }, ['key', key])
    }
    for (const ch of used) {
      if (!(ch in r.key)) custom(ctx, 'keyMissing', { key: ch }, ['pattern'])
    }
  })

const Shapeless = z.looseObject({
  ...RecipeCommon,
  ingredients: z.array(Ingredient).min(1).max(9),
  result: ItemStack
})

const Cooking = z.looseObject({
  ...RecipeCommon,
  ingredient: Ingredient,
  result: ItemStack,
  experience: z.number().min(0).optional(),
  cookingtime: z.number().int().min(1).optional()
})

const Stonecutting = z.looseObject({ ...RecipeCommon, ingredient: Ingredient, result: ItemStack })

const SmithingTransform = z.looseObject({
  ...RecipeCommon,
  template: Ingredient.optional(),
  base: Ingredient,
  addition: Ingredient.optional(),
  result: ItemStack
})

const SmithingTrim = z.looseObject({
  ...RecipeCommon,
  template: Ingredient,
  base: Ingredient,
  addition: Ingredient,
  // Required since 1.21.5 (trim pattern id), absent before.
  pattern: Id.optional()
})

/** 1.21.4: "result" is an item id; 1.21.5+: an item stack, whose id may be left out (the input item is kept). */
const Transmute = z.looseObject({
  ...RecipeCommon,
  input: Ingredient,
  material: Ingredient,
  result: z.unknown().superRefine((v, ctx) => {
    if (typeof v === 'string') return checkId(v, ctx, false)
    const parsed = ItemStack.partial({ id: true }).safeParse(v)
    if (!parsed.success) custom(ctx, 'itemStack')
  })
})

/** Recipe types with a schema; other types (special crafting, brewing...) are only checked for a "type". */
const RECIPE_SCHEMAS: Record<string, z.ZodType> = {
  'minecraft:crafting_shaped': Shaped,
  'minecraft:crafting_shapeless': Shapeless,
  'minecraft:smelting': Cooking,
  'minecraft:blasting': Cooking,
  'minecraft:smoking': Cooking,
  'minecraft:campfire_cooking': Cooking,
  'minecraft:stonecutting': Stonecutting,
  'minecraft:smithing_transform': SmithingTransform,
  'minecraft:smithing_trim': SmithingTrim,
  'minecraft:crafting_transmute': Transmute
}

/** Every vanilla recipe type of the support window (unknown minecraft: types get a warning). */
export const KNOWN_RECIPE_TYPES = new Set([
  ...Object.keys(RECIPE_SCHEMAS),
  'minecraft:brewing',
  'minecraft:crafting_decorated_pot',
  'minecraft:crafting_dye',
  'minecraft:crafting_imbue',
  'minecraft:crafting_special_armordye',
  'minecraft:crafting_special_bannerduplicate',
  'minecraft:crafting_special_bookcloning',
  'minecraft:crafting_special_firework_rocket',
  'minecraft:crafting_special_firework_star',
  'minecraft:crafting_special_firework_star_fade',
  'minecraft:crafting_special_mapcloning',
  'minecraft:crafting_special_mapextending',
  'minecraft:crafting_special_repairitem',
  'minecraft:crafting_special_shielddecoration',
  'minecraft:crafting_special_shulkerboxcoloring',
  'minecraft:crafting_special_suspiciousstew',
  'minecraft:crafting_special_tippedarrow'
])

const RecipeBase = z.looseObject({ type: z.string().min(1) })

/** Number provider: a number or an object ({"type": "minecraft:uniform", "min": 1, "max": 3}...). */
const NumberProvider = z.unknown().superRefine((v, ctx) => {
  if (typeof v === 'number' || (typeof v === 'object' && v !== null && !Array.isArray(v))) return
  custom(ctx, 'numberProvider')
})

/** Loot entry types and the field each one requires (any of the listed names; tag entries use "items" in 26.3). */
const ENTRY_REQUIRED: Record<string, readonly string[] | null> = {
  'minecraft:item': ['name'],
  'minecraft:tag': ['name', 'items'],
  'minecraft:dynamic': ['name'],
  'minecraft:loot_table': ['value'],
  'minecraft:empty': null,
  'minecraft:alternatives': ['children'],
  'minecraft:group': ['children'],
  'minecraft:sequence': ['children'],
  'minecraft:slots': null
}

type Entry = { type: string; [k: string]: unknown }
const LootEntry: z.ZodType<Entry> = z.lazy(() =>
  z
    .looseObject({
      type: z.string().min(1),
      weight: z.number().int().min(1).optional(),
      quality: z.number().int().optional(),
      name: Id.optional(),
      children: z.array(LootEntry).optional()
    })
    .superRefine((e, ctx) => {
      const type = fullId(e.type)
      const required = ENTRY_REQUIRED[type]
      if (required && required.every((key) => e[key] === undefined)) {
        custom(ctx, 'required', { key: required[0]! }, [required[0]!])
      }
      if (type === 'minecraft:loot_table') {
        const value = e['value']
        if (typeof value === 'string') checkId(value, ctx, false, ['value'])
        else if (typeof value !== 'object' || value === null)
          custom(ctx, 'lootTableValue', {}, ['value'])
      }
    })
)

const LootPool = z.looseObject({
  rolls: NumberProvider,
  bonus_rolls: NumberProvider.optional(),
  entries: z.array(LootEntry)
})

const LootTable = z.looseObject({
  type: Id.optional(),
  pools: z.array(LootPool).optional(),
  random_sequence: Id.optional()
})

const TagValue = z.unknown().superRefine((v, ctx) => {
  if (typeof v === 'string') return checkId(v, ctx, true)
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const entry = v as { id?: unknown; required?: unknown }
    if (entry.id === undefined) custom(ctx, 'required', { key: 'id' }, ['id'])
    else checkId(entry.id, ctx, true, ['id'])
    if (entry.required !== undefined && typeof entry.required !== 'boolean') {
      custom(ctx, 'type', { expected: 'boolean' }, ['required'])
    }
    return
  }
  custom(ctx, 'tagValue')
})

const Tag = z.looseObject({ replace: z.boolean().optional(), values: z.array(TagValue) })

const Advancement = z
  .looseObject({
    parent: Id.optional(),
    display: z
      .looseObject({
        icon: ItemStack,
        title: TextComponent,
        description: TextComponent,
        frame: z.enum(['task', 'goal', 'challenge']).optional(),
        background: z.string().optional(),
        show_toast: z.boolean().optional(),
        announce_to_chat: z.boolean().optional(),
        hidden: z.boolean().optional()
      })
      .optional(),
    criteria: z.record(
      z.string(),
      z.looseObject({ trigger: Id, conditions: z.record(z.string(), z.unknown()).optional() })
    ),
    requirements: z.array(z.array(z.string()).min(1)).optional(),
    rewards: z
      .looseObject({
        recipes: z.array(Id).optional(),
        loot: z.array(Id).optional(),
        experience: z.number().int().optional(),
        function: Id.optional()
      })
      .optional(),
    sends_telemetry_event: z.boolean().optional()
  })
  .superRefine((a, ctx) => {
    const names = new Set(Object.keys(a.criteria))
    if (names.size === 0) custom(ctx, 'noCriteria', {}, ['criteria'])
    a.requirements?.forEach((group, i) =>
      group.forEach((name, j) => {
        if (!names.has(name)) custom(ctx, 'unknownCriterion', { name }, ['requirements', i, j])
      })
    )
  })

// ---------- zod issues -> DataIssue ----------

function valueAt(root: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let v = root
  for (const key of path) {
    if (v === null || typeof v !== 'object') return undefined
    v = (v as Record<PropertyKey, unknown>)[key]
  }
  return v
}

const TYPE_NAMES: Record<string, string> = {
  string: 'string',
  number: 'number',
  int: 'integer',
  boolean: 'boolean',
  object: 'object',
  array: 'array',
  record: 'object'
}

function toPath(path: ReadonlyArray<PropertyKey>): Array<string | number> {
  return path.map((k) => (typeof k === 'number' ? k : String(k)))
}

/** Converts zod issues to data issues (errors). */
function fromZod(error: z.ZodError, root: unknown): DataIssue[] {
  return error.issues.map((issue): DataIssue => {
    const path = toPath(issue.path)
    switch (issue.code) {
      case 'invalid_type': {
        if (valueAt(root, issue.path) === undefined && path.length > 0) {
          return {
            severity: 'error',
            code: 'required',
            params: { key: String(path[path.length - 1]) },
            path
          }
        }
        const expected = TYPE_NAMES[issue.expected] ?? 'value'
        return { severity: 'error', code: 'type', params: { expected }, path }
      }
      case 'invalid_value':
        return {
          severity: 'error',
          code: 'value',
          params: { values: issue.values.map((v) => String(v)).join(', ') },
          path
        }
      case 'too_small':
        return {
          severity: 'error',
          code:
            issue.origin === 'array'
              ? 'tooFewItems'
              : issue.origin === 'string'
                ? 'tooShort'
                : 'tooSmall',
          params: { min: Number(issue.minimum) },
          path
        }
      case 'too_big':
        return {
          severity: 'error',
          code:
            issue.origin === 'array'
              ? 'tooManyItems'
              : issue.origin === 'string'
                ? 'tooLong'
                : 'tooBig',
          params: { max: Number(issue.maximum) },
          path
        }
      case 'custom': {
        // z.unknown() fields (ids, ingredients...) see a missing key as undefined.
        if (valueAt(root, issue.path) === undefined && path.length > 0) {
          const key = String(path[path.length - 1])
          return { severity: 'error', code: 'required', params: { key }, path }
        }
        const { code, ...params } = (issue.params ?? {}) as { code?: string } & Record<
          string,
          string | number
        >
        return {
          severity: 'error',
          code: code ?? 'invalid',
          ...(Object.keys(params).length ? { params } : {}),
          path
        }
      }
      default:
        return { severity: 'error', code: 'invalid', path }
    }
  })
}

function check(schema: z.ZodType, value: unknown): DataIssue[] {
  const r = schema.safeParse(value)
  return r.success ? [] : fromZod(r.error, value)
}

// ---------- warnings: ids the game does not know ----------

type Push = (
  code: string,
  params: Record<string, string | number>,
  path: Array<string | number>
) => void

function lintIdRef(
  raw: unknown,
  path: Array<string | number>,
  registry: 'item' | 'block',
  ctx: DataContext,
  push: Push
): void {
  if (typeof raw !== 'string') return
  if (raw.startsWith('#')) {
    const id = fullId(raw.slice(1))
    const known = ctx.tags?.[registry]
    if (known && id.startsWith('minecraft:') && !known.has(id))
      push('unknownTag', { id: `#${id}` }, path)
    return
  }
  const id = fullId(raw)
  const known = registry === 'item' ? ctx.items : ctx.blocks
  if (known && id.startsWith('minecraft:') && !known.has(id)) {
    push(registry === 'item' ? 'unknownItem' : 'unknownBlock', { id }, path)
  }
}

function lintIngredient(
  v: unknown,
  path: Array<string | number>,
  ctx: DataContext,
  push: Push
): void {
  if (Array.isArray(v)) v.forEach((item, i) => lintIdRef(item, [...path, i], 'item', ctx, push))
  else lintIdRef(v, path, 'item', ctx, push)
}

function lintStack(v: unknown, path: Array<string | number>, ctx: DataContext, push: Push): void {
  if (typeof v === 'string') lintIdRef(v, path, 'item', ctx, push)
  else if (v && typeof v === 'object')
    lintIdRef((v as { id?: unknown }).id, [...path, 'id'], 'item', ctx, push)
}

const INGREDIENT_KEYS = ['ingredient', 'base', 'addition', 'template', 'input', 'material']

function lintRecipe(r: Record<string, unknown>, ctx: DataContext, push: Push): void {
  for (const key of INGREDIENT_KEYS) if (key in r) lintIngredient(r[key], [key], ctx, push)
  if (Array.isArray(r['ingredients'])) {
    r['ingredients'].forEach((v, i) => lintIngredient(v, ['ingredients', i], ctx, push))
  }
  if (r['key'] && typeof r['key'] === 'object') {
    for (const [k, v] of Object.entries(r['key'] as Record<string, unknown>))
      lintIngredient(v, ['key', k], ctx, push)
  }
  if ('result' in r) lintStack(r['result'], ['result'], ctx, push)
}

function lintEntries(
  entries: unknown,
  path: Array<string | number>,
  ctx: DataContext,
  push: Push
): void {
  if (!Array.isArray(entries)) return
  entries.forEach((e, i) => {
    if (!e || typeof e !== 'object') return
    const entry = e as Record<string, unknown>
    const type = typeof entry['type'] === 'string' ? fullId(entry['type']) : ''
    if (type && !(type in ENTRY_REQUIRED) && type.startsWith('minecraft:')) {
      push('unknownEntryType', { type }, [...path, i, 'type'])
    }
    if (type === 'minecraft:item') lintIdRef(entry['name'], [...path, i, 'name'], 'item', ctx, push)
    if (type === 'minecraft:tag') {
      if (typeof entry['name'] === 'string')
        lintIdRef(`#${entry['name']}`, [...path, i, 'name'], 'item', ctx, push)
      else lintIdRef(entry['items'], [...path, i, 'items'], 'item', ctx, push)
    }
    lintEntries(entry['children'], [...path, i, 'children'], ctx, push)
  })
}

function lint(
  kind: DataKind,
  value: Record<string, unknown>,
  ctx: DataContext,
  registry?: string
): DataIssue[] {
  const out: DataIssue[] = []
  const push: Push = (code, params, path) => out.push({ severity: 'warning', code, params, path })
  if (kind === 'recipe') {
    const type = typeof value['type'] === 'string' ? fullId(value['type']) : ''
    if (type.startsWith('minecraft:') && !KNOWN_RECIPE_TYPES.has(type))
      push('unknownRecipeType', { type }, ['type'])
    lintRecipe(value, ctx, push)
  } else if (kind === 'loot_table') {
    const pools = value['pools']
    if (Array.isArray(pools)) {
      pools.forEach((p, i) => {
        if (p && typeof p === 'object')
          lintEntries((p as Record<string, unknown>)['entries'], ['pools', i, 'entries'], ctx, push)
      })
    }
  } else if (kind === 'tag' && (registry === 'item' || registry === 'block')) {
    const values = value['values']
    if (Array.isArray(values)) {
      values.forEach((v, i) => {
        if (typeof v === 'string') lintIdRef(v, ['values', i], registry, ctx, push)
        // An entry with "required": false may name content from mods: not checked.
        else if (v && typeof v === 'object' && (v as { required?: unknown }).required !== false) {
          lintIdRef((v as { id?: unknown }).id, ['values', i, 'id'], registry, ctx, push)
        }
      })
    }
  } else if (kind === 'advancement') {
    const display = value['display']
    if (display && typeof display === 'object') {
      lintStack((display as Record<string, unknown>)['icon'], ['display', 'icon'], ctx, push)
    }
  }
  return out
}

/**
 * Checks a parsed data file of `kind` (errors from the schema, then warnings about unknown ids when `ctx` has id
 * lists). `registry` is the tag registry for tags. Kinds without a schema only need to be a JSON value.
 */
export function validateData(
  kind: DataKind,
  value: unknown,
  ctx: DataContext = {},
  registry?: string
): DataIssue[] {
  if (kind === 'function') return []
  if (kind === 'other') return []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ severity: 'error', code: 'notObject', path: [] }]
  }
  let errors: DataIssue[]
  if (kind === 'recipe') {
    errors = check(RecipeBase, value)
    const type = (value as { type?: unknown }).type
    const schema = typeof type === 'string' ? RECIPE_SCHEMAS[fullId(type)] : undefined
    if (errors.length === 0 && schema) errors = check(schema, value)
  } else if (kind === 'loot_table') errors = check(LootTable, value)
  else if (kind === 'tag') errors = check(Tag, value)
  else errors = check(Advancement, value)
  return [...errors, ...lint(kind, value as Record<string, unknown>, ctx, registry)]
}
