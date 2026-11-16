/**
 * Worker thread entry for bulk operations. Loaded by runner.ts through electron-vite's `?modulePath` import, so it is
 * bundled as its own file in out/main. Protocol (worker -> parent):
 *   { type: 'progress', done, total } | { type: 'done', results } | { type: 'error', message }
 */
import { parentPort, workerData } from 'node:worker_threads'
import { computeBulk, type BulkJob } from './compute'
import type { BulkWorkerMessage } from './runner'

const port = parentPort
if (!port) throw new Error('bulk-worker must run in a worker thread')

function post(message: BulkWorkerMessage, transfer: ArrayBuffer[] = []): void {
  port?.postMessage(message, transfer)
}

computeBulk(workerData as BulkJob, (done, total) => post({ type: 'progress', done, total }))
  .then((results) => {
    // Transfer the PNG buffers instead of copying them.
    const transfer = results.flatMap((r) =>
      r.png && r.png.byteOffset === 0 && r.png.byteLength === r.png.buffer.byteLength
        ? [r.png.buffer as ArrayBuffer]
        : []
    )
    post({ type: 'done', results }, transfer)
  })
  .catch((err: unknown) =>
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  )
