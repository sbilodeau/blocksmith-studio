import { handle } from './registry'
import type { BulkService } from '../services/bulk/service'

/** Manual bulk actions of the grid (PLAN M5): preview in a worker, then apply as one history entry. */
export function registerBulkHandlers(deps: { bulk: BulkService }): void {
  const { bulk } = deps
  handle('bulk.preview', ({ packId, paths, operations }) => bulk.preview(packId, paths, operations))
  handle('bulk.apply', ({ previewId, paths }) => bulk.apply(previewId, paths))
  handle('bulk.discard', ({ previewId }) => bulk.discard(previewId))
}
