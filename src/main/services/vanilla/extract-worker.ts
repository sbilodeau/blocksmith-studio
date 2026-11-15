/**
 * Worker thread entry for vanilla extraction. Loaded by worker-runner.ts through electron-vite's `?modulePath`
 * import, so it is bundled as its own file in out/main. Protocol (worker -> parent):
 *   { type: 'progress', phase, done, total } | { type: 'done', index } | { type: 'error', code?, params?, message }
 */
import { parentPort, workerData } from 'node:worker_threads'
import { extractVanillaJar, type ExtractJob } from './extract'
import { VanillaError } from './errors'
import type { WorkerMessage } from './worker-runner'

const port = parentPort
if (!port) throw new Error('extract-worker must run in a worker thread')

function post(message: WorkerMessage): void {
  port?.postMessage(message)
}

extractVanillaJar(workerData as ExtractJob, (phase, done, total) =>
  post({ type: 'progress', phase, done, total })
)
  .then((index) => post({ type: 'done', index }))
  .catch((err: unknown) => {
    post({
      type: 'error',
      code: err instanceof VanillaError ? err.code : undefined,
      params: err instanceof VanillaError ? err.params : undefined,
      message: err instanceof Error ? err.message : String(err)
    })
  })
