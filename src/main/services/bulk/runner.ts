import { Worker, type WorkerOptions } from 'node:worker_threads'
import { AppErrorException } from '../../ipc/registry'
import { computeBulk, type BulkItemResult, type BulkJob, type BulkProgress } from './compute'

export type BulkWorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; results: BulkItemResult[] }
  | { type: 'error'; message: string }

/** Runs a bulk job (in a worker thread in the app, in-process in tests). Rejects with 'bulk.aborted' on abort. */
export type BulkRunner = (
  job: BulkJob,
  onProgress?: BulkProgress,
  signal?: AbortSignal
) => Promise<BulkItemResult[]>

/** In-process runner (tests, and a fallback when workers are unavailable). */
export const inProcessBulkRunner: BulkRunner = async (job, onProgress, signal) => {
  try {
    return await computeBulk(job, onProgress, signal)
  } catch (err) {
    if (signal?.aborted) throw new AppErrorException('bulk.aborted')
    throw err
  }
}

export type BulkWorkerFactory = (path: string, options: WorkerOptions) => Worker

/** Runs bulk jobs in a worker thread loaded from `workerPath` (the bundled bulk-worker.js). */
export function createWorkerBulkRunner(
  workerPath: string,
  createWorker: BulkWorkerFactory = (path, options) => new Worker(path, options)
): BulkRunner {
  return (job, onProgress, signal) =>
    new Promise<BulkItemResult[]>((resolve, reject) => {
      if (signal?.aborted) return reject(new AppErrorException('bulk.aborted'))
      let settled = false
      const worker = createWorker(workerPath, { workerData: job })
      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        fn()
      }
      const onAbort = (): void => {
        settle(() => reject(new AppErrorException('bulk.aborted')))
        void worker.terminate()
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      worker.on('message', (message: BulkWorkerMessage) => {
        if (message.type === 'progress') onProgress?.(message.done, message.total)
        else if (message.type === 'done') settle(() => resolve(message.results))
        else settle(() => reject(new AppErrorException('bulk.failed', { reason: message.message })))
      })
      worker.on('error', (err) =>
        settle(() => reject(new AppErrorException('bulk.failed', { reason: err.message })))
      )
      worker.on('exit', (code) =>
        settle(() =>
          reject(
            new AppErrorException('bulk.failed', { reason: `worker exited with code ${code}` })
          )
        )
      )
    })
}
