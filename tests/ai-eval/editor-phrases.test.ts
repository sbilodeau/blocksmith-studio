import { writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { EvalReport, ProviderConfig } from '@shared/ai/types'
import { PROVIDER_PRESETS } from '@shared/ai/presets'
import { comparisonMarkdown } from '@shared/ai/eval-compare'
import { createProviderRegistry } from '../../src/main/services/ai/providers'
import {
  buildEvalReport,
  loadEvalCases,
  parseModelRef,
  runEval
} from '../../src/main/services/ai/eval/runner'
import { DEFAULT_THRESHOLDS } from '../../src/main/services/ai/eval/report'

/**
 * Live FR/EN evaluation (PLAN 9.4). Runs when at least one provider key is set (environment or .env.local):
 *   OLLAMA_API_KEY      -> Ollama Cloud models ("gpt-oss:120b" or "ollama-cloud/gpt-oss:120b")
 *   OPENAI_API_KEY      -> "openai/gpt-4o-mini"
 *   OPENROUTER_API_KEY  -> "openrouter/qwen/qwen3-32b"
 *
 *   npm run test:ai                                                     default model
 *   BLOCKSMITH_EVAL_MODEL=qwen3-coder:480b npm run test:ai
 *   BLOCKSMITH_EVAL_MODEL="gpt-oss:120b,openrouter/qwen/qwen3-32b" npm run test:ai   side by side
 *   BLOCKSMITH_EVAL_CASES=rotate-left-90,flip-horizontal npm run test:ai
 * Writes ai-eval-report.md at the repo root (with a comparison table for several models) and fails when a model
 * scores below 90% overall or shows more than a 10-point FR-EN gap.
 */

const KEYS: Record<string, string | undefined> = {
  'ollama-cloud': process.env['OLLAMA_API_KEY'],
  openai: process.env['OPENAI_API_KEY'],
  openrouter: process.env['OPENROUTER_API_KEY']
}
export const DEFAULT_EVAL_MODEL = 'gpt-oss:120b'
const ROOT = join(__dirname, '../..')

const PROVIDERS: ProviderConfig[] = PROVIDER_PRESETS.filter((p) => KEYS[p.id]).map((p) => ({
  id: p.id,
  kind: p.kind,
  label: p.label,
  baseUrl: p.baseUrl,
  enabled: true,
  ...(p.extraHeaders ? { extraHeaders: p.extraHeaders } : {})
}))

describe.skipIf(PROVIDERS.length === 0)('AI FR/EN evaluation (live)', () => {
  it(
    'maps French and English requests to the expected tool calls',
    { timeout: 60 * 60_000 },
    async () => {
      const models = (process.env['BLOCKSMITH_EVAL_MODEL'] || DEFAULT_EVAL_MODEL)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => parseModelRef(s))
      const only = process.env['BLOCKSMITH_EVAL_CASES']?.split(',').map((s) => s.trim())
      const cases = loadEvalCases(join(ROOT, 'resources/data/ai-eval/phrases.json')).filter(
        (c) => !only?.length || only.includes(c.id)
      )
      const providers = createProviderRegistry({
        getProviders: () => PROVIDERS,
        secrets: {
          get: async (id) => KEYS[id],
          has: async (id) => KEYS[id] !== undefined
        },
        fetch: (url, init) => fetch(url, init)
      })

      const reports: EvalReport[] = []
      for (const model of models) {
        const label = `${model.providerId}/${model.modelId}`
        const results = await runEval({
          providers,
          model,
          cases,
          concurrency: Number(process.env['BLOCKSMITH_EVAL_CONCURRENCY'] ?? 3),
          onResult: (r, done, total) =>
            console.log(
              `[${label} ${done}/${total}] ${r.pass ? 'ok  ' : 'FAIL'} ${r.language} ${r.caseId}`
            )
        })
        reports.push(buildEvalReport(model, results, cases.length * 2))
      }

      const markdown = [
        ...(reports.length > 1 ? [comparisonMarkdown(reports)] : []),
        ...reports.map((r) => r.markdown)
      ].join('\n')
      writeFileSync(join(ROOT, 'ai-eval-report.md'), markdown)
      console.log(markdown)
      for (const r of reports) {
        const label = `${r.model.providerId}/${r.model.modelId}`
        expect(r.overall.rate, `${label}: overall pass rate`).toBeGreaterThanOrEqual(
          DEFAULT_THRESHOLDS.minRate
        )
        expect(r.gap, `${label}: FR-EN gap`).toBeLessThanOrEqual(DEFAULT_THRESHOLDS.maxGap)
      }
    }
  )
})
