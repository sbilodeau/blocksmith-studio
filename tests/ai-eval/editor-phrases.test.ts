import { writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROVIDERS } from '@shared/model/settings'
import { createProviderRegistry } from '../../src/main/services/ai/providers'
import { loadEvalCases, parseModelRef, runEval } from '../../src/main/services/ai/eval/runner'
import { summarize, toMarkdown } from '../../src/main/services/ai/eval/report'

/**
 * Live FR/EN evaluation (PLAN 9.4). Runs only when OLLAMA_API_KEY is set (environment or .env.local):
 *   npm run test:ai                                   default model
 *   BLOCKSMITH_EVAL_MODEL=qwen3-coder:480b npm run test:ai
 *   BLOCKSMITH_EVAL_CASES=rotate-left-90,flip-horizontal npm run test:ai
 * Writes ai-eval-report.md at the repo root and fails below 90% overall or above a 10-point FR-EN gap.
 */

const key = process.env['OLLAMA_API_KEY']
export const DEFAULT_EVAL_MODEL = 'gpt-oss:120b'
const ROOT = join(__dirname, '../..')

describe.skipIf(!key)('AI FR/EN evaluation (live)', () => {
  it(
    'maps French and English requests to the expected tool calls',
    { timeout: 30 * 60_000 },
    async () => {
      const model = parseModelRef(process.env['BLOCKSMITH_EVAL_MODEL'] || DEFAULT_EVAL_MODEL)
      const only = process.env['BLOCKSMITH_EVAL_CASES']?.split(',').map((s) => s.trim())
      const cases = loadEvalCases(join(ROOT, 'resources/data/ai-eval/phrases.json')).filter(
        (c) => !only?.length || only.includes(c.id)
      )
      const providers = createProviderRegistry({
        getProviders: () => DEFAULT_PROVIDERS,
        secrets: { get: async () => key, has: async () => true },
        fetch: (url, init) => fetch(url, init)
      })
      const results = await runEval({
        providers,
        model,
        cases,
        concurrency: Number(process.env['BLOCKSMITH_EVAL_CONCURRENCY'] ?? 3),
        onResult: (r, done, total) =>
          console.log(`[${done}/${total}] ${r.pass ? 'ok  ' : 'FAIL'} ${r.language} ${r.caseId}`)
      })
      const summary = summarize(results)
      const report = toMarkdown(`${model.providerId}/${model.modelId}`, results, summary)
      writeFileSync(join(ROOT, 'ai-eval-report.md'), report)
      console.log(report)
      expect(summary.overall.rate, 'overall pass rate').toBeGreaterThanOrEqual(
        summary.thresholds.minRate
      )
      expect(summary.gap, 'FR-EN gap').toBeLessThanOrEqual(summary.thresholds.maxGap)
    }
  )
})
