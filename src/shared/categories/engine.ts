import { z } from 'zod'
import { globToRegExp } from './glob'

/**
 * Category engine: maps texture paths to category ids using glob rules.
 * Globs are matched against the texture key, i.e. the path below `assets/<namespace>/textures/`
 * ("block/stone.png", "entity/zombie/zombie.png"), so the same rules apply to every namespace.
 */

export const FALLBACK_CATEGORY = 'other'

/** Category ids: lowercase letters, digits, "_" and "-". */
export const CATEGORY_ID_RE = /^[a-z0-9_-]{1,40}$/
/** Longest plain-text label of a custom category. */
export const MAX_CATEGORY_LABEL = 40

export const CategoryRuleSchema = z
  .object({
    id: z.string().regex(CATEGORY_ID_RE),
    /** vue-i18n key of the display name, "category.<id>" (built-in categories). */
    i18nKey: z.string().min(1).optional(),
    /** Plain-text display name typed by the user (custom categories, not translated). Wins over i18nKey. */
    label: z.string().trim().min(1).max(MAX_CATEGORY_LABEL).optional(),
    /** Pack path of the texture used as the category's tile. */
    icon: z.string(),
    include: z.array(z.string()),
    exclude: z.array(z.string()).optional(),
    /** Display order (ascending). */
    order: z.number().int(),
    /** A hidden category matches nothing and is not shown (a built-in category the user does not want). */
    hidden: z.boolean().optional()
  })
  .refine((r) => r.i18nKey !== undefined || r.label !== undefined, {
    message: 'A category needs an i18nKey or a label'
  })
export type CategoryRule = z.infer<typeof CategoryRuleSchema>

/** Most categories in a mapping (and in a pack's overrides). */
export const MAX_CATEGORIES = 100
/** Most include (or exclude) globs in one category. */
export const MAX_GLOBS_PER_CATEGORY = 200

/**
 * Pack-scope rules ("This pack", stored as `categoryOverrides` in .blocksmith/project.json): a rule whose id is in
 * the "All packs" mapping replaces that category for the pack, any other rule adds a category to the pack.
 */
export const CategoryOverridesSchema = z.array(CategoryRuleSchema).max(MAX_CATEGORIES)

export const CategoryMappingSchema = z.object({
  schemaVersion: z.literal(1),
  categories: z.array(CategoryRuleSchema)
})
export type CategoryMapping = z.infer<typeof CategoryMappingSchema>

const TEXTURE_PATH = /^assets\/([^/]+)\/textures\/(.+)$/

/** "assets/minecraft/textures/block/stone.png" -> "block/stone.png"; null for non-texture paths. */
export function textureKey(path: string): string | null {
  const match = TEXTURE_PATH.exec(path)
  return match ? match[2] : null
}

/** Splits a texture pack path into namespace / folder / name ("block", "stone"). */
export function splitTexturePath(
  path: string
): { namespace: string; folder: string; name: string } | null {
  const match = TEXTURE_PATH.exec(path)
  if (!match) return null
  const rest = match[2]
  const slash = rest.lastIndexOf('/')
  const file = slash >= 0 ? rest.slice(slash + 1) : rest
  const dot = file.lastIndexOf('.')
  return {
    namespace: match[1],
    folder: slash >= 0 ? rest.slice(0, slash) : '',
    name: dot > 0 ? file.slice(0, dot) : file
  }
}

export interface CategoryEngine {
  /**
   * Visible rules in display order (hidden ones are left out). The fallback category is always present: added when
   * missing, and never hidden.
   */
  readonly rules: readonly CategoryRule[]
  /** Category ids of a texture (pack path), in display order. Never empty. */
  categorize(path: string): string[]
}

interface CompiledRule {
  id: string
  include: RegExp[]
  exclude: RegExp[]
}

/** Compiles globs, skipping any that cannot compile (the editor and main reject them before saving). */
function compileGlobs(globs: readonly string[]): RegExp[] {
  const out: RegExp[] = []
  for (const glob of globs) {
    try {
      out.push(globToRegExp(glob))
    } catch {
      // An invalid glob matches nothing.
    }
  }
  return out
}

export function createCategoryEngine(input: readonly CategoryRule[]): CategoryEngine {
  const rules = input
    .filter((r) => !r.hidden || r.id === FALLBACK_CATEGORY)
    .map((r) => (r.hidden ? { ...r, hidden: undefined } : r))
    .sort((a, b) => a.order - b.order)
  if (!rules.some((r) => r.id === FALLBACK_CATEGORY)) {
    rules.push({
      id: FALLBACK_CATEGORY,
      i18nKey: `category.${FALLBACK_CATEGORY}`,
      icon: '',
      include: [],
      order: Number.MAX_SAFE_INTEGER
    })
  }
  const compiled: CompiledRule[] = rules.map((r) => ({
    id: r.id,
    include: compileGlobs(r.include),
    exclude: compileGlobs(r.exclude ?? [])
  }))
  // Texture paths repeat across packs and calls; categorizing is pure, so memoize it.
  const cache = new Map<string, string[]>()

  function categorize(path: string): string[] {
    const cached = cache.get(path)
    if (cached) return cached
    const key = textureKey(path) ?? path
    const ids: string[] = []
    for (const rule of compiled) {
      if (rule.include.some((re) => re.test(key)) && !rule.exclude.some((re) => re.test(key))) {
        ids.push(rule.id)
      }
    }
    if (ids.length === 0) ids.push(FALLBACK_CATEGORY)
    cache.set(path, ids)
    return ids
  }

  return { rules, categorize }
}
