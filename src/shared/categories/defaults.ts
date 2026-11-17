import defaultMappingJson from '../../../resources/data/categories.json'
import {
  CategoryMappingSchema,
  createCategoryEngine,
  type CategoryEngine,
  type CategoryRule
} from './engine'

/** Default mapping shipped in resources/data/categories.json (validated at load). */
export const DEFAULT_CATEGORY_RULES: readonly CategoryRule[] =
  CategoryMappingSchema.parse(defaultMappingJson).categories

const BUILTIN_IDS = new Set(DEFAULT_CATEGORY_RULES.map((r) => r.id))

/** True for the categories of the default mapping (they can be edited and hidden, not deleted). */
export function isBuiltinCategory(id: string): boolean {
  return BUILTIN_IDS.has(id)
}

let defaultEngine: CategoryEngine | undefined

/** Shared engine built from the default mapping. */
export function getDefaultCategoryEngine(): CategoryEngine {
  defaultEngine ??= createCategoryEngine(DEFAULT_CATEGORY_RULES)
  return defaultEngine
}
