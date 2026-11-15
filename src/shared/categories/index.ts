import defaultMappingJson from '../../../resources/data/categories.json'
import {
  CategoryMappingSchema,
  createCategoryEngine,
  type CategoryEngine,
  type CategoryRule
} from './engine'

export * from './engine'
export { globToRegExp, matchGlob } from './glob'

/** Default mapping shipped in resources/data/categories.json (validated at load). */
export const DEFAULT_CATEGORY_RULES: readonly CategoryRule[] =
  CategoryMappingSchema.parse(defaultMappingJson).categories

let defaultEngine: CategoryEngine | undefined

/** Shared engine built from the default mapping. */
export function getDefaultCategoryEngine(): CategoryEngine {
  defaultEngine ??= createCategoryEngine(DEFAULT_CATEGORY_RULES)
  return defaultEngine
}
