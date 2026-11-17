import { DEFAULT_CATEGORY_RULES, isBuiltinCategory } from './defaults'
import {
  CATEGORY_ID_RE,
  FALLBACK_CATEGORY,
  MAX_CATEGORIES,
  MAX_CATEGORY_LABEL,
  MAX_GLOBS_PER_CATEGORY,
  createCategoryEngine,
  textureKey,
  type CategoryRule
} from './engine'
import { globIssue, globToRegExp, type GlobIssue } from './glob'

/**
 * The two scopes of the category mapping (PLAN 4.2, M11):
 * - "All packs": the user's copy of the whole mapping (userData/categories.json), defaults when there is none;
 * - "This pack": extra rules in the pack's project.json, applied on top (replace a category by id, or add one).
 */

/**
 * The "All packs" rules: the saved user mapping, or the defaults when there is none. Built-in categories missing
 * from a saved mapping (added by a newer version of the app; the editor cannot delete them) are appended.
 */
export function userCategoryRules(
  saved: readonly CategoryRule[] | null | undefined
): CategoryRule[] {
  if (!saved) return DEFAULT_CATEGORY_RULES.map((r) => ({ ...r }))
  const ids = new Set(saved.map((r) => r.id))
  return [...saved, ...DEFAULT_CATEGORY_RULES.filter((r) => !ids.has(r.id))]
}

/** Applies pack rules on top of a mapping: same id = replacement (keeps its position), new id = added at the end. */
export function mergeCategoryRules(
  base: readonly CategoryRule[],
  overrides: readonly CategoryRule[] | null | undefined
): CategoryRule[] {
  const out = [...base]
  for (const rule of overrides ?? []) {
    const at = out.findIndex((r) => r.id === rule.id)
    if (at >= 0) out[at] = rule
    else out.push(rule)
  }
  return out
}

/** Rules that apply to a pack: user mapping (or defaults) plus the pack's overrides. */
export function resolveCategoryRules(
  saved: readonly CategoryRule[] | null | undefined,
  overrides: readonly CategoryRule[] | null | undefined
): CategoryRule[] {
  return mergeCategoryRules(userCategoryRules(saved), overrides)
}

/** Stable key of a rule list (compiled engines are cached by it). */
export function categoryRulesKey(rules: readonly CategoryRule[]): string {
  return JSON.stringify(rules)
}

/** Longest icon path. */
export const MAX_ICON_LENGTH = 512

export type CategoryIssueCode =
  | 'invalidId'
  | 'duplicateId'
  | 'labelRequired'
  | 'labelTooLong'
  | 'fallbackHidden'
  | 'iconTooLong'
  | 'tooManyGlobs'
  | 'tooManyCategories'
  | 'glob'

/** A problem in a rule list (i18n: `categoriesEditor.issues.<code>`, glob ones `categoriesEditor.globIssues.<glob>`). */
export interface CategoryIssue {
  code: CategoryIssueCode
  /** Index of the rule in the list (-1 for the whole list). */
  index: number
  id: string
  field?: 'include' | 'exclude'
  /** Position of the glob in `field`. */
  globIndex?: number
  globIssue?: GlobIssue
  glob?: string
}

/**
 * Checks a rule list before it is saved (the editor shows the issues inline; main refuses a list with any).
 * Custom categories (not in the default mapping) need a plain-text label; `other` cannot be hidden.
 */
export function validateCategoryRules(rules: readonly CategoryRule[]): CategoryIssue[] {
  const issues: CategoryIssue[] = []
  if (rules.length > MAX_CATEGORIES) {
    issues.push({ code: 'tooManyCategories', index: -1, id: '' })
  }
  const seen = new Set<string>()
  rules.forEach((rule, index) => {
    const id = rule.id
    if (!CATEGORY_ID_RE.test(id)) issues.push({ code: 'invalidId', index, id })
    else if (seen.has(id)) issues.push({ code: 'duplicateId', index, id })
    seen.add(id)
    const label = rule.label?.trim() ?? ''
    if (!rule.i18nKey && !isBuiltinCategory(id) && label === '') {
      issues.push({ code: 'labelRequired', index, id })
    }
    if (label.length > MAX_CATEGORY_LABEL) issues.push({ code: 'labelTooLong', index, id })
    if (id === FALLBACK_CATEGORY && rule.hidden) issues.push({ code: 'fallbackHidden', index, id })
    if (rule.icon.length > MAX_ICON_LENGTH) issues.push({ code: 'iconTooLong', index, id })
    for (const field of ['include', 'exclude'] as const) {
      const globs = rule[field] ?? []
      if (globs.length > MAX_GLOBS_PER_CATEGORY) {
        issues.push({ code: 'tooManyGlobs', index, id, field })
      }
      globs.forEach((glob, globIndex) => {
        const problem = globIssue(glob)
        if (problem) {
          issues.push({ code: 'glob', index, id, field, globIndex, globIssue: problem, glob })
        }
      })
    }
  })
  return issues
}

/** Number of textures of each category (what the navigator would show), with the fallback, for a list of paths. */
export function countCategoryMatches(
  rules: readonly CategoryRule[],
  paths: readonly string[]
): Record<string, number> {
  const engine = createCategoryEngine(rules)
  const counts: Record<string, number> = {}
  for (const path of paths) {
    for (const id of engine.categorize(path)) counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}

/** Number of paths one glob matches (0 for an invalid glob). */
export function countGlobMatches(glob: string, paths: readonly string[]): number {
  if (globIssue(glob)) return 0
  const re = globToRegExp(glob)
  let n = 0
  for (const path of paths) if (re.test(textureKey(path) ?? path)) n++
  return n
}

/**
 * Categories a texture would get ("test a path"): accepts a pack path ("assets/minecraft/textures/block/stone.png")
 * or a texture key ("block/stone.png").
 */
export function categorizePath(rules: readonly CategoryRule[], input: string): string[] {
  const path = input.trim().replace(/^\/+/, '')
  return createCategoryEngine(rules).categorize(path)
}

/** Id for a new custom category from its label: "Épées de feu" -> "epees_de_feu", unique among `taken`. */
export function newCategoryId(label: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'custom'
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const id = `${base}_${n}`
    if (!used.has(id)) return id
  }
}
