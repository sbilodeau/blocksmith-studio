import { EventEmitter } from 'events'
import type { Worker, WorkerOptions } from 'worker_threads'
import { describe, expect, it } from 'vitest'
import type { VanillaIndex } from '@shared/model/vanilla'
import {
  createWorkerExtractor,
  type WorkerMessage
} from '../../src/main/services/vanilla/worker-runner'
import { VanillaError } from '../../src/main/services/vanilla/errors'

const job = { jarPath: '/x/26.3.jar', outDir: '/u/vanilla/26.3', versionId: '26.3' }
const index: VanillaIndex = {
  schemaVersion: 1,
  versionId: '26.3',
  resourcePack: { major: 97, minor: 1 },
  dataPack: { major: 121, minor: 0 },
  createdAt: '2026-11-15T00:00:00.000Z',
  entries: {}
}

/** Fake worker: replays a script of messages / events on the next tick. */
function fakeWorker(script: (w: EventEmitter) => void): {
  factory: (path: string, options: WorkerOptions) => Worker
  calls: Array<{ path: string; options: WorkerOptions }>
} {
  const calls: Array<{ path: string; options: WorkerOptions }> = []
  return {
    calls,
    factory: (path, options) => {
      calls.push({ path, options })
      const worker = new EventEmitter()
      setTimeout(() => script(worker), 0)
      return worker as unknown as Worker
    }
  }
}

const msg = (w: EventEmitter, m: WorkerMessage): boolean => w.emit('message', m)

describe('createWorkerExtractor', () => {
  it('passes the job as workerData, forwards progress and resolves with the index', async () => {
    const { factory, calls } = fakeWorker((w) => {
      msg(w, { type: 'progress', phase: 'extract', done: 1, total: 2 })
      msg(w, { type: 'progress', phase: 'index', done: 2, total: 2 })
      msg(w, { type: 'done', index })
      w.emit('exit', 0)
    })
    const progress: string[] = []
    const run = createWorkerExtractor('/out/main/extract-worker.js', factory)
    await expect(run(job, (p, d, t) => progress.push(`${p}:${d}/${t}`))).resolves.toEqual(index)
    expect(calls[0]).toEqual({ path: '/out/main/extract-worker.js', options: { workerData: job } })
    expect(progress).toEqual(['extract:1/2', 'index:2/2'])
  })

  it('keeps the code reported by the worker', async () => {
    const { factory } = fakeWorker((w) =>
      msg(w, {
        type: 'error',
        code: 'vanilla.jarVersionMismatch',
        params: { expected: '26.3', actual: '1.21.4' },
        message: 'vanilla.jarVersionMismatch'
      })
    )
    const err = await createWorkerExtractor('w.js', factory)(job).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(VanillaError)
    expect(err).toMatchObject({
      code: 'vanilla.jarVersionMismatch',
      params: { expected: '26.3', actual: '1.21.4' }
    })
  })

  it('maps unexpected worker failures to vanilla.extractFailed', async () => {
    const crash = fakeWorker((w) => w.emit('error', new Error('boom')))
    await expect(createWorkerExtractor('w.js', crash.factory)(job)).rejects.toMatchObject({
      code: 'vanilla.extractFailed',
      params: { reason: 'boom' }
    })

    const silentExit = fakeWorker((w) => w.emit('exit', 1))
    await expect(createWorkerExtractor('w.js', silentExit.factory)(job)).rejects.toMatchObject({
      code: 'vanilla.extractFailed'
    })

    const uncoded = fakeWorker((w) => msg(w, { type: 'error', message: 'EACCES' }))
    await expect(createWorkerExtractor('w.js', uncoded.factory)(job)).rejects.toMatchObject({
      code: 'vanilla.extractFailed',
      params: { reason: 'EACCES' }
    })
  })
})
