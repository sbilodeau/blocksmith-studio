import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { ChatRequest } from '@shared/ai/types'
import { loadEvalCases, parseModelRef, runEval } from '../../src/main/services/ai/eval/runner'
import { summarize } from '../../src/main/services/ai/eval/report'
import { DONE_END, DONE_TOOLS, fakeProvider, text, toolCall } from '../unit/ai-agent-fakes'

const PHRASES = join(__dirname, '../../resources/data/ai-eval/phrases.json')
const model = { providerId: 'fake', modelId: 'm1' }

/** A "model" that only understands left rotations, in both languages. */
function rotateOnly(req: ChatRequest): ReturnType<typeof text>[] {
  const last = req.messages[req.messages.length - 1]
  if (last?.role === 'tool') return [text('ok'), DONE_END]
  const user = req.messages.filter((m) => m.role === 'user').pop()?.text ?? ''
  if (/gauche|left/i.test(user)) {
    return [toolCall('rotate', { degrees: 90, direction: 'counterclockwise' }), DONE_TOOLS]
  }
  return [text('?'), DONE_END]
}

describe('eval runner', () => {
  it('loads and validates every case', () => {
    const cases = loadEvalCases(PHRASES)
    expect(cases.length).toBeGreaterThanOrEqual(30)
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
  })

  it('parses model refs with and without a provider', () => {
    expect(parseModelRef('gpt-oss:120b')).toEqual({
      providerId: 'ollama-cloud',
      modelId: 'gpt-oss:120b'
    })
    expect(parseModelRef('openrouter/openai/gpt-5')).toEqual({
      providerId: 'openrouter',
      modelId: 'openai/gpt-5'
    })
    expect(parseModelRef('hf.co/x:latest')).toEqual({
      providerId: 'hf.co',
      modelId: 'x:latest'
    })
  })

  it('runs each case in both languages and scores the tool calls', async () => {
    const cases = loadEvalCases(PHRASES).filter((c) =>
      ['rotate-left-90', 'flip-horizontal'].includes(c.id)
    )
    expect(cases).toHaveLength(2)
    const scripts = Array.from({ length: 20 }, () => rotateOnly)
    const { providers } = fakeProvider(scripts)
    const progress: number[] = []
    const results = await runEval({
      providers,
      model,
      cases,
      concurrency: 1,
      onResult: (_r, done) => progress.push(done)
    })
    expect(results).toHaveLength(4)
    expect(progress).toEqual([1, 2, 3, 4])
    const rotate = results.filter((r) => r.caseId === 'rotate-left-90')
    expect(rotate.every((r) => r.pass)).toBe(true)
    expect(results.filter((r) => r.caseId === 'flip-horizontal').some((r) => r.pass)).toBe(false)
    const s = summarize(results)
    expect(s.overall.rate).toBe(50)
    expect(s.gap).toBe(0)
  })

  it('records provider errors as failures', async () => {
    const cases = loadEvalCases(PHRASES).slice(0, 1)
    const err = Object.assign(new Error('nope'), { code: 'ai.rateLimited' })
    const { providers } = fakeProvider([err, err])
    const results = await runEval({ providers, model, cases, concurrency: 1 })
    expect(results.every((r) => !r.pass && r.error)).toBe(true)
  })
})
