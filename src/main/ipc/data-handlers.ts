import { handle } from './registry'
import type { DataService } from '../services/packs'

export interface DataHandlerDeps {
  data: DataService
}

/** Data pack files (PLAN M10): list, read, save, create and delete, each write one history entry. */
export function registerDataHandlers({ data }: DataHandlerDeps): void {
  handle('data.list', ({ packId }) => data.list(packId))
  handle('data.read', ({ packId, path }) => data.read(packId, path))
  handle('data.save', ({ packId, path, text }) => data.save(packId, path, text))
  handle('data.create', ({ packId, path, text }) => data.create(packId, path, text))
  handle('data.delete', ({ packId, path }) => data.remove(packId, path))
}
