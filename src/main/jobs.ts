import { randomUUID } from 'crypto'
import type { JobKind, JobProgress } from '@shared/model/jobs'
import type { JobReporter, ProgressFn } from './services/contracts'

/**
 * Creates a JobReporter that forwards progress to the renderer, throttled so a tight extraction loop does not
 * flood IPC: at most one event per `intervalMs` per job, plus phase changes and completion.
 */
export function createJobReporter(
  emit: (progress: JobProgress) => void,
  options: { intervalMs?: number; now?: () => number } = {}
): JobReporter {
  const interval = options.intervalMs ?? 80
  const now = options.now ?? Date.now
  return {
    start(kind: JobKind): ProgressFn {
      const jobId = randomUUID()
      let last = 0
      let lastPhase = ''
      return (phase, done, total) => {
        const t = now()
        const finished = total > 0 && done >= total
        if (phase !== lastPhase || finished || t - last >= interval) {
          last = t
          lastPhase = phase
          emit({ jobId, kind, phase, done, total })
        }
      }
    }
  }
}
