import { describe, expect, it } from 'vitest'
import type { EvalReport } from '@shared/ai/types'
import {
  comparisonMarkdown,
  formatCost,
  missedRequests,
  rankReports
} from '@shared/ai/eval-compare'
import { headerLines, parseHeaderLines, providerIdFor, PROVIDER_PRESETS } from '@shared/ai/presets'
import { summarize, toMarkdown, type EvalResult } from '../../src/main/services/ai/eval/report'

function report(
  modelId: string,
  rate: number,
  extra: Partial<EvalReport> = {},
  failures: EvalReport['failures'] = []
): EvalReport {
  const s = { total: 10, passed: rate / 10, rate }
  return {
    model: { providerId: 'p', modelId },
    overall: s,
    fr: s,
    en: s,
    gap: 0,
    ok: rate >= 90,
    avgLatencyMs: 1000,
    inputTokens: 10,
    outputTokens: 5,
    stopped: false,
    failures,
    markdown: '',
    ...extra
  }
}

const miss = (caseId: string, language: 'fr' | 'en'): EvalReport['failures'][number] => ({
  caseId,
  language,
  phrase: caseId,
  calls: ''
})

describe('eval comparison', () => {
  it('ranks by overall rate, then gap, then cost, then latency', () => {
    const rows = rankReports([
      report('slow', 90, { avgLatencyMs: 5000 }),
      report('best', 100),
      report('cheap', 90, { costUsd: 0.01 }),
      report('uneven', 90, { gap: 20 }),
      report('fast', 90, { avgLatencyMs: 10 })
    ])
    expect(rows.map((r) => [r.rank, r.label])).toEqual([
      [1, 'p/best'],
      [2, 'p/cheap'],
      [3, 'p/fast'],
      [4, 'p/slow'],
      [5, 'p/uneven']
    ])
  })

  it('lists the requests missed by at least one model, most missed first', () => {
    const missed = missedRequests([
      report('a', 80, {}, [miss('darker', 'fr'), miss('flip', 'en')]),
      report('b', 90, {}, [miss('darker', 'fr')])
    ])
    expect(missed.map((m) => [m.key, m.missedBy])).toEqual([
      ['darker (fr)', ['p/a', 'p/b']],
      ['flip (en)', ['p/a']]
    ])
  })

  it('writes a padded Markdown comparison; stopped runs show ? for requests they may not have sent', () => {
    const md = comparisonMarkdown([
      report('a', 80, { costUsd: 0.25 }, [miss('flip', 'en')]),
      report('b', 100, { stopped: true, ok: false })
    ])
    expect(md).toContain('## AI FR/EN evaluation - 2 models compared')
    const lines = md.split('\n').filter((l) => l.startsWith('|'))
    // Columns line up in the raw source.
    const tableLines = lines.slice(0, 4)
    expect(new Set(tableLines.map((l) => l.length)).size).toBe(1)
    expect(md).toMatch(/\| 1 +\| p\/b +\| 100% \(10\/10\)/)
    expect(md).toContain('stopped')
    expect(md).toContain('$0.25')
    expect(md).toMatch(/\| flip \(en\) \| \? +\| FAIL \|/)
  })

  it('formats costs', () => {
    expect(formatCost(undefined)).toBe('-')
    expect(formatCost(0.00042)).toBe('$0.0004')
    expect(formatCost(1.5)).toBe('$1.50')
  })
})

describe('eval cost in the per-model report', () => {
  const r = (costUsd?: number): EvalResult => ({
    caseId: 'c',
    language: 'fr',
    phrase: 'x',
    pass: true,
    calls: [],
    latencyMs: 10,
    inputTokens: 1,
    outputTokens: 1,
    ...(costUsd !== undefined ? { costUsd } : {})
  })

  it('sums known costs and shows them; unknown stays unknown', () => {
    const known = summarize([r(0.001), r(), r(0.002)])
    expect(known.costUsd).toBeCloseTo(0.003)
    expect(toMarkdown('m', [r(0.001)], summarize([r(0.001)]))).toContain('Cost: $0.0010.')
    expect(summarize([r(), r()]).costUsd).toBeUndefined()
  })
})

describe('provider presets', () => {
  it('offers Ollama Cloud, OpenAI, OpenRouter, local Ollama and custom', () => {
    expect(PROVIDER_PRESETS.map((p) => p.id)).toEqual([
      'ollama-cloud',
      'openai',
      'openrouter',
      'ollama-local',
      'custom'
    ])
    expect(PROVIDER_PRESETS.find((p) => p.id === 'openai')!.baseUrl).toBe(
      'https://api.openai.com/v1'
    )
  })

  it('makes unique ids from labels', () => {
    expect(providerIdFor('OpenRouter', [])).toBe('openrouter')
    expect(providerIdFor('OpenRouter', ['openrouter', 'openrouter-2'])).toBe('openrouter-3')
    expect(providerIdFor('!!!', [])).toBe('provider')
  })

  it('parses and prints "Name: value" header lines', () => {
    expect(parseHeaderLines('X-Title: Blocksmith\n\n HTTP-Referer: https://a.b/c ')).toEqual({
      'X-Title': 'Blocksmith',
      'HTTP-Referer': 'https://a.b/c'
    })
    expect(parseHeaderLines('  ')).toBeUndefined()
    expect(() => parseHeaderLines('no colon')).toThrow()
    expect(headerLines({ A: '1', B: '2' })).toBe('A: 1\nB: 2')
  })
})
