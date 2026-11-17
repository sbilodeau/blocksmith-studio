import { handle } from './registry'
import type { CategoryMappingStore } from '../services/categories'
import type { PackService } from '../services/packs'

export interface CategoryHandlerDeps {
  store: Pick<CategoryMappingStore, 'state' | 'save' | 'reset'>
  packs: Pick<PackService, 'categoryOverrides' | 'setCategoryOverrides'>
  /** Main forwards this as 'packs.changed' without a pack id: every open pack tab reloads its categories. */
  notifyAllPacks: () => void
}

/** Category mapping editor (M11): the "All packs" mapping and a pack's own rules. */
export function registerCategoryHandlers({
  store,
  packs,
  notifyAllPacks
}: CategoryHandlerDeps): void {
  handle('categories.get', () => store.state())

  handle('categories.save', async ({ rules }) => {
    const state = await store.save(rules)
    notifyAllPacks()
    return state
  })

  handle('categories.reset', async () => {
    const state = await store.reset()
    notifyAllPacks()
    return state
  })

  handle('pack.categoryOverrides', ({ packId }) => packs.categoryOverrides(packId))
  handle('pack.setCategoryOverrides', ({ packId, overrides }) =>
    packs.setCategoryOverrides(packId, overrides)
  )
}
