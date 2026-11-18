import { handle } from './registry'
import type { ItemService } from '../services/items'

export interface ItemHandlerDeps {
  items: ItemService
}

/** Custom items (PLAN M14): each write is one history entry. */
export function registerItemHandlers({ items }: ItemHandlerDeps): void {
  handle('items.list', ({ packId }) => items.list(packId))
  handle('items.read', ({ packId, id }) => items.read(packId, id))
  handle('items.create', ({ packId, item, textureFrom }) => items.create(packId, item, textureFrom))
  handle('items.save', ({ packId, id, item }) => items.save(packId, id, item))
  handle('items.delete', ({ packId, id }) => items.remove(packId, id))
  handle('items.regenerate', ({ packId, id }) => items.regenerate(packId, id))
  handle('items.catalog', ({ packId }) => items.catalog(packId))
  handle('items.context', ({ packId, base }) => items.context(packId, base))
}
