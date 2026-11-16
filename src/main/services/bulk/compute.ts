import { applyOperations, type BulkOperation } from '@shared/bulk/operations'
import { decodePng, encodePng } from '@shared/image'
import type { StyleBrief } from '@shared/model/brief'

/**
 * The CPU part of bulk operations: decode, apply, encode. Pure (no Electron, no file access), so it runs in the
 * bulk worker thread in the app and directly in tests.
 */

export interface BulkJobItem {
  path: string
  png: Uint8Array
  ops: BulkOperation[]
  /** Height of one frame for animated strips (operations run per frame). */
  frameHeight?: number
}

export interface BulkJob {
  items: BulkJobItem[]
  brief?: StyleBrief
}

export interface BulkItemResult {
  path: string
  /** PNG after the operations; absent when nothing changed or on error. */
  png?: Uint8Array
  changedPixels: number
  /** English reason when the texture could not be processed (bad PNG, invalid operation). */
  error?: string
}

export type BulkProgress = (done: number, total: number) => void

export function computeBulkItem(item: BulkJobItem, brief?: StyleBrief): BulkItemResult {
  try {
    const before = decodePng(item.png)
    const { image, changedPixels } = applyOperations(before, item.ops, {
      frameHeight: item.frameHeight,
      brief
    })
    return changedPixels > 0
      ? { path: item.path, png: encodePng(image), changedPixels }
      : { path: item.path, changedPixels: 0 }
  } catch (err) {
    return {
      path: item.path,
      changedPixels: 0,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export async function computeBulk(
  job: BulkJob,
  onProgress?: BulkProgress,
  signal?: AbortSignal
): Promise<BulkItemResult[]> {
  const results: BulkItemResult[] = []
  const total = job.items.length
  for (const [i, item] of job.items.entries()) {
    if (signal?.aborted) throw new Error('aborted')
    results.push(computeBulkItem(item, job.brief))
    onProgress?.(i + 1, total)
    // Yield now and then so an in-process run (tests) does not starve the event loop.
    if (i % 64 === 63) await new Promise((r) => setImmediate(r))
  }
  return results
}
