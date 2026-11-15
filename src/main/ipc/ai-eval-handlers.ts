import type { EvalProgress } from '@shared/ai/types'
import { AppErrorException, handle } from './registry'
import type { ProviderRegistry } from '../services/contracts'
import { runEvalReport } from '../services/ai/eval/runner'

/**
 * Settings > "Test this model": runs the FR/EN evaluation in main (keys never leave it) and streams progress.
 * One evaluation at a time; ai.eval.stop cancels it and returns what ran so far.
 */
export function registerAiEvalHandlers(deps: {
  providers: ProviderRegistry
  emit: (progress: EvalProgress) => void
}): void {
  let current: AbortController | null = null

  handle('ai.eval.run', async ({ model, quick }) => {
    if (current) throw new AppErrorException('ai.evalBusy')
    const controller = new AbortController()
    current = controller
    try {
      return await runEvalReport({
        providers: deps.providers,
        model,
        quick,
        signal: controller.signal,
        onResult: (r, done, total) =>
          deps.emit({ done, total, caseId: r.caseId, language: r.language, pass: r.pass })
      })
    } finally {
      current = null
    }
  })

  handle('ai.eval.stop', () => {
    current?.abort()
  })
}
