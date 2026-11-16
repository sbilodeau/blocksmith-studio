import { describe, expect, it, vi } from 'vitest'
import {
  evalFixture,
  summarize,
  toMarkdown,
  type EvalResult
} from '../../src/main/services/ai/eval/report'
import { getPixel, toHex } from '@shared/image'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

function r(caseId: string, language: 'fr' | 'en', pass: boolean): EvalResult {
  return {
    caseId,
    language,
    phrase: `${caseId} ${language}`,
    pass,
    calls: pass ? [{ id: 'c1', name: 'rotate', args: { degrees: 90 } }] : [],
    latencyMs: 100,
    inputTokens: 10,
    outputTokens: 5
  }
}

describe('eval summary', () => {
  it('computes per-language rates and the FR-EN gap', () => {
    const results = [
      r('a', 'fr', true),
      r('a', 'en', true),
      r('b', 'fr', false),
      r('b', 'en', true)
    ]
    const s = summarize(results)
    expect(s.overall).toEqual({ total: 4, passed: 3, rate: 75 })
    expect(s.fr.rate).toBe(50)
    expect(s.en.rate).toBe(100)
    expect(s.gap).toBe(50)
    expect(s.ok).toBe(false)
    expect(s.inputTokens).toBe(40)
    expect(s.avgLatencyMs).toBe(100)
  })

  it('passes at the thresholds', () => {
    const results: EvalResult[] = []
    for (let i = 0; i < 10; i++) {
      results.push(r(`c${i}`, 'fr', i !== 0), r(`c${i}`, 'en', true))
    }
    const s = summarize(results)
    expect(s.overall.rate).toBe(95)
    expect(s.gap).toBe(10)
    expect(s.ok).toBe(true)
  })

  it('fails an empty run', () => {
    expect(summarize([]).ok).toBe(false)
  })
})

describe('eval markdown', () => {
  it('lists failures with the calls the model made', () => {
    const fail = { ...r('b', 'fr', false), calls: [{ id: 'x', name: 'flip', args: { axis: 'v' } }] }
    const results = [r('a', 'fr', true), r('a', 'en', true), fail, r('b', 'en', true)]
    const md = toMarkdown('ollama-cloud/qwen3', results, summarize(results))
    expect(md).toContain('FAIL')
    expect(md).toMatch(/\| b +\| FAIL \| ok +\| fr: flip\(\{"axis":"v"\}\)/)
    expect(md).toContain('FR-EN gap: 50 points')
  })

  it('reports errors in place of calls', () => {
    const err = { ...r('a', 'en', false), error: 'ai.rateLimited' }
    const md = toMarkdown('m', [err], summarize([err]))
    expect(md).toContain('en: error: ai.rateLimited')
  })
})

describe('eval fixture', () => {
  it('is a deterministic 16x16 texture with a few colors', () => {
    const a = evalFixture('sample16')
    expect(a.width).toBe(16)
    expect(toHex(getPixel(a, 0, 0))).toMatch(/^#bdbdbd/)
    expect(toHex(getPixel(a, 15, 15))).toMatch(/^#7f7f7f/)
    expect(() => evalFixture('nope')).toThrow()
  })
})

describe('creation eval cases', () => {
  it('run on the sample pack and match apply_to_all calls by operation and filter', async () => {
    const { evalPack } = await import('../../src/main/services/ai/eval/report')
    const { runEvalCase, bundledEvalCases } = await import('../../src/main/services/ai/eval/runner')
    const { DONE_END, DONE_TOOLS, fakeProvider, text, toolCall } = await import('./ai-agent-fakes')
    const pack = evalPack('sample_pack')
    expect(pack.textures.filter((t) => t.categories.includes('ores')).map((t) => t.name)).toEqual([
      'iron_ore',
      'gold_ore'
    ])
    const ores = bundledEvalCases().find((c) => c.id === 'creation-ores-redder')!
    const fake = fakeProvider([
      [
        toolCall('apply_to_all', {
          operation: { tool: 'hue_shift', args: { degrees: -20 } },
          filter: { categories: ['ores'] }
        }),
        DONE_TOOLS
      ],
      [text('ok'), DONE_END],
      [
        toolCall('apply_to_all', { operation: { tool: 'hue_shift', args: { degrees: -20 } } }),
        DONE_TOOLS
      ],
      [text('ok'), DONE_END]
    ])
    const model = { providerId: 'fake', modelId: 'm1' }
    const pass = await runEvalCase(ores, 'en', { providers: fake.providers, model })
    expect(pass).toMatchObject({ pass: true })
    // Without a filter on ores the case fails.
    const fail = await runEvalCase(ores, 'fr', { providers: fake.providers, model })
    expect(fail).toMatchObject({ pass: false })
  })
})
