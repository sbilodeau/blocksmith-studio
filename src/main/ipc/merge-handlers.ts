import { handle } from './registry'
import type { MergeService } from '../services/merge'

/** Merge and send-to-pack (PLAN 8.6, M8): preview (nothing written), then apply as one history entry. */
export function registerMergeHandlers(deps: { merge: MergeService }): void {
  const { merge } = deps
  handle('merge.preview', (input) => merge.preview(input))
  handle('merge.apply', (input) => merge.apply(input))
  handle('merge.discard', ({ planId }) => merge.discard(planId))
}
