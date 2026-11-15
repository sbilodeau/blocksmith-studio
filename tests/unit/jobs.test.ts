import { describe, expect, it } from 'vitest'
import type { JobProgress } from '@shared/model/jobs'
import { createJobReporter } from '../../src/main/jobs'

describe('job reporter', () => {
  it('throttles progress but always reports phase changes and completion', () => {
    const events: JobProgress[] = []
    let clock = 0
    const reporter = createJobReporter((p) => events.push(p), { intervalMs: 100, now: () => clock })
    const progress = reporter.start('vanilla.prepare')
    progress('extract', 1, 10)
    clock = 10
    progress('extract', 2, 10) // throttled
    clock = 150
    progress('extract', 3, 10)
    clock = 160
    progress('index', 0, 5) // phase change
    progress('index', 5, 5) // finished
    expect(events.map((e) => `${e.phase}:${e.done}`)).toEqual([
      'extract:1',
      'extract:3',
      'index:0',
      'index:5'
    ])
    expect(new Set(events.map((e) => e.jobId)).size).toBe(1)
    expect(events[0].kind).toBe('vanilla.prepare')
  })
})
