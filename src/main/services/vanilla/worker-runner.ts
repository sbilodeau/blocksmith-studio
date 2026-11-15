import { Worker, type WorkerOptions } from 'node:worker_threads'
import type { VanillaIndex } from '@shared/model/vanilla'
import type { ExtractPhase, ExtractRunner } from './extract'
import { VanillaError, VanillaErrorCode } from './errors'

export type WorkerMessage =
  | { type: 'progress'; phase: ExtractPhase; done: number; total: number }
  | { type: 'done'; index: VanillaIndex }
  | { type: 'error'; code?: string; params?: Record<string, string | number>; message: string }

export type WorkerFactory = (path: string, options: WorkerOptions) => Worker

/**
 * Runs extraction jobs in a worker thread loaded from `workerPath` (the bundled extract-worker.js), forwarding
 * its progress messages. Worker failures become VanillaError('vanilla.extractFailed') unless the worker reported
 * a more specific code.
 */
export function createWorkerExtractor(
  workerPath: string,
  createWorker: WorkerFactory = (path, options) => new Worker(path, options)
): ExtractRunner {
  return (job, onProgress) =>
    new Promise<VanillaIndex>((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        fn()
      }
      const worker = createWorker(workerPath, { workerData: job })
      worker.on('message', (message: WorkerMessage) => {
        if (message.type === 'progress') onProgress?.(message.phase, message.done, message.total)
        else if (message.type === 'done') settle(() => resolve(message.index))
        else if (message.type === 'error') {
          settle(() =>
            reject(
              new VanillaError(message.code ?? VanillaErrorCode.extractFailed, {
                ...(message.params ?? {}),
                ...(message.code ? {} : { reason: message.message })
              })
            )
          )
        }
      })
      worker.on('error', (err) =>
        settle(() =>
          reject(new VanillaError(VanillaErrorCode.extractFailed, { reason: err.message }))
        )
      )
      worker.on('exit', (code) =>
        settle(() =>
          reject(
            new VanillaError(VanillaErrorCode.extractFailed, {
              reason: `worker exited with code ${code}`
            })
          )
        )
      )
    })
}
