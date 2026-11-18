import { referencedIds, tagValues } from '../datapack/diff'

/**
 * Vanilla recipes that take an item as an ingredient, directly or through an item tag (PLAN M14: a custom item also
 * works as its base item in vanilla recipes, so the item page warns about them).
 */

/** Item tag id ("minecraft:planks") -> its values as written (ids and "#tags"). */
export type ItemTags = ReadonlyMap<string, readonly string[]>

/** `data/<ns>/tags/item/<path>.json` -> "<ns>:<path>" */
const ITEM_TAG_PATH = /^data\/([a-z0-9_.-]+)\/tags\/item\/([a-z0-9_./-]+)\.json$/
/** `data/<ns>/recipe/<path>.json` -> "<ns>:<path>" */
const RECIPE_PATH = /^data\/([a-z0-9_.-]+)\/recipe\/([a-z0-9_./-]+)\.json$/

export function itemTagId(path: string): string | null {
  const m = ITEM_TAG_PATH.exec(path)
  return m ? `${m[1]}:${m[2]}` : null
}

export function recipeId(path: string): string | null {
  const m = RECIPE_PATH.exec(path)
  return m ? `${m[1]}:${m[2]}` : null
}

/** Item tags from parsed tag files. */
export function itemTagsFrom(
  files: Iterable<{ path: string; json: unknown }>
): Map<string, string[]> {
  const tags = new Map<string, string[]>()
  for (const { path, json } of files) {
    const id = itemTagId(path)
    if (id) tags.set(id, tagValues(json))
  }
  return tags
}

/** Every item tag that contains `itemId`, nested tags included ("#minecraft:planks" form). */
export function tagsContaining(itemId: string, tags: ItemTags): Set<string> {
  const found = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const [tag, values] of tags) {
      const ref = `#${tag}`
      if (found.has(ref)) continue
      if (values.some((v) => v === itemId || found.has(v))) {
        found.add(ref)
        grew = true
      }
    }
  }
  return found
}

/** The JSON value without its "result" (a recipe making the item does not use it). */
function ingredientsOf(recipe: unknown): unknown {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return recipe
  return Object.fromEntries(
    Object.entries(recipe as Record<string, unknown>).filter(([key]) => key !== 'result')
  )
}

/** Ids ("minecraft:golden_apple") of the recipes using `itemId` as an ingredient, sorted. */
export function recipesUsing(
  itemId: string,
  recipes: Iterable<{ path: string; json: unknown }>,
  tags: ItemTags
): string[] {
  const refs = tagsContaining(itemId, tags)
  refs.add(itemId)
  const out: string[] = []
  for (const { path, json } of recipes) {
    const id = recipeId(path)
    if (!id) continue
    if (referencedIds(ingredientsOf(json), 500).some((r) => refs.has(r))) out.push(id)
  }
  return out.sort()
}
