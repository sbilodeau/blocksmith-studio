import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { ChatRequest } from '@shared/ai/types'
import {
  bundledEvalCases,
  loadEvalCases,
  parseModelRef,
  QUICK_CASE_IDS,
  runEval,
  runEvalReport
} from '../../src/main/services/ai/eval/runner'
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

  it('runs navigation cases on the selection fixture, matching "textures" subsets', async () => {
    const cases = loadEvalCases(PHRASES).filter((c) =>
      ['nav-ores-darker', 'nav-outline-planks'].includes(c.id)
    )
    expect(cases.map((c) => c.context)).toEqual(['navigation', 'navigation'])
    /** Darkens the ores by glob, outlines the planks by number. */
    const navModel = (req: ChatRequest): ReturnType<typeof text>[] => {
      const last = req.messages[req.messages.length - 1]
      if (last?.role === 'tool') return [text('ok'), DONE_END]
      const user = req.messages.filter((m) => m.role === 'user').pop()?.text ?? ''
      expect(user).toContain('[Selection: 4 textures]')
      return /minerais|ores/i.test(user)
        ? [toolCall('brightness', { delta: -0.3, textures: { match: '*_ore' } }), DONE_TOOLS]
        : [toolCall('outline', { color: '#000000', textures: { indices: [4] } }), DONE_TOOLS]
    }
    const { providers } = fakeProvider(Array.from({ length: 10 }, () => navModel))
    const results = await runEval({ providers, model, cases, concurrency: 1 })
    expect(results.map((r) => [r.caseId, r.language, r.pass])).toEqual([
      ['nav-ores-darker', 'fr', true],
      ['nav-ores-darker', 'en', true],
      ['nav-outline-planks', 'fr', true],
      ['nav-outline-planks', 'en', true]
    ])
  })

  it('runs data cases on one file of the sample data pack (the data editor chat)', async () => {
    const cases = loadEvalCases(PHRASES).filter((c) => c.context === 'data')
    expect(cases.map((c) => c.id)).toEqual(['data-recipe-count', 'data-tag-add', 'data-loot-two'])
    /** Edits the open file the way a good model would: reads it from the request, changes one thing. */
    const dataModel = (req: ChatRequest): ReturnType<typeof text>[] => {
      const last = req.messages[req.messages.length - 1]
      if (last?.role === 'tool') return [text('ok'), DONE_END]
      const user = last?.text ?? ''
      expect(user).toContain('[Open file]')
      const json = JSON.parse(
        /CURRENT FILE \(as in the editor\):\n```json\n([\s\S]*?)\n```/.exec(user)![1]!
      )
      if (json.result) json.result.count = 8
      else if (json.values) json.values.push('minecraft:basalt')
      else json.pools[0].entries[0].functions = [{ function: 'minecraft:set_count', count: 2 }]
      return [toolCall('edit_file', { json }), DONE_TOOLS]
    }
    const { providers } = fakeProvider(Array.from({ length: 12 }, () => dataModel))
    const results = await runEval({ providers, model, cases, concurrency: 1 })
    expect(results.every((r) => r.pass)).toBe(true)
    expect(results).toHaveLength(6)
  })

  it('runs item cases on the item page of a custom item (the item chat)', async () => {
    const cases = loadEvalCases(PHRASES).filter((c) => c.context === 'item')
    expect(cases.map((c) => c.id)).toEqual([
      'item-damage',
      'item-stack',
      'item-night-vision',
      'item-recipe',
      'item-rename',
      'item-glint',
      'item-durability'
    ])
    /** Edits the open item the way a good model would: reads it from the request, changes one thing. */
    const itemModel = (req: ChatRequest): ReturnType<typeof text>[] => {
      const last = req.messages[req.messages.length - 1]
      if (last?.role === 'tool') return [text('ok'), DONE_END]
      const user = last?.text ?? ''
      expect(user).toContain('[Open item]')
      const item = JSON.parse(
        /DEFINITION \(as in the form\):\n```json\n([\s\S]*?)\n```/.exec(user)![1]!
      )
      const ask = user.slice(user.lastIndexOf('User request:'))
      const e = 'minecraft:emerald'
      if (/\b9\b/.test(ask)) item.weapon.attackDamage = 9
      else if (/16/.test(ask)) item.maxStack = 16
      else if (/nocturne|night/i.test(ask))
        item.food.effects = [{ effect: 'minecraft:night_vision', seconds: 30 }]
      else if (/meraude|emerald/i.test(ask))
        item.recipe = { type: 'shaped', grid: [e, e, e, null, null, null, null, null, null] }
      else if (/lame|blade/i.test(ask)) {
        item.id = 'ruby_blade'
        item.names = { en_us: 'Ruby Blade', fr_fr: 'Lame de rubis' }
      } else if (/brill|shimmer/i.test(ask)) item.glint = true
      else item.durability = 500
      return [toolCall('edit_item', { item }), DONE_TOOLS]
    }
    const { providers } = fakeProvider(Array.from({ length: 30 }, () => itemModel))
    const results = await runEval({ providers, model, cases, concurrency: 1 })
    expect(results.filter((r) => !r.pass)).toEqual([])
    expect(results).toHaveLength(14)
  })

  it('runs creation item cases on the combined pack (write_item, delete_item)', async () => {
    const cases = loadEvalCases(PHRASES).filter((c) => c.fixture === 'sample_combined')
    expect(cases.map((c) => c.id)).toEqual([
      'creation-item-sword',
      'creation-item-apple',
      'creation-item-helmet',
      'creation-item-pickaxe',
      'creation-item-delete'
    ])
    const creationModel = (req: ChatRequest): ReturnType<typeof text>[] => {
      const last = req.messages[req.messages.length - 1]
      if (last?.role === 'tool') return [text('ok'), DONE_END]
      const user = last?.text ?? ''
      expect(user).toContain('Custom items of the pack (namespace "eval_pack")')
      expect(req.tools!.map((t) => t.name)).toContain('write_item')
      const ask = user.slice(user.lastIndexOf('User request:'))
      const item = (fields: Record<string, unknown>): ReturnType<typeof toolCall> =>
        toolCall('write_item', {
          item: {
            schemaVersion: 1,
            id: 'x',
            namespace: 'eval_pack',
            names: { en_us: 'X' },
            ...fields
          }
        })
      if (/supprime|delete/i.test(ask)) return [toolCall('delete_item', { id: 'ruby' }), DONE_TOOLS]
      if (/épée|sword/i.test(ask))
        return [item({ kind: 'weapon', weapon: { attackDamage: 9, attackSpeed: 1.6 } }), DONE_TOOLS]
      if (/pomme|apple/i.test(ask)) {
        const effects = [{ effect: 'minecraft:regeneration', seconds: 10 }]
        return [item({ kind: 'food', food: { nutrition: 4, saturation: 2, effects } }), DONE_TOOLS]
      }
      if (/casque|helmet/i.test(ask))
        return [item({ kind: 'armor', armor: { slot: 'head', armor: 3 } }), DONE_TOOLS]
      return [item({ kind: 'tool', tool: { type: 'pickaxe' } }), DONE_TOOLS]
    }
    const { providers } = fakeProvider(Array.from({ length: 30 }, () => creationModel))
    const results = await runEval({ providers, model, cases, concurrency: 1 })
    expect(results.filter((r) => !r.pass)).toEqual([])
    expect(results).toHaveLength(10)
  })

  it('quick test ids exist in the bundled cases', () => {
    const ids = bundledEvalCases().map((c) => c.id)
    for (const id of QUICK_CASE_IDS) expect(ids).toContain(id)
  })

  it('builds the Settings report for the quick test', async () => {
    const { providers } = fakeProvider(Array.from({ length: 40 }, () => rotateOnly))
    const report = await runEvalReport({ providers, model, quick: true, concurrency: 2 })
    expect(report.overall.total).toBe(QUICK_CASE_IDS.length * 2)
    expect(report.stopped).toBe(false)
    expect(report.ok).toBe(false)
    expect(report.failures.length).toBeGreaterThan(0)
    expect(report.markdown).toContain('fake/m1')
  })

  it('reports a stopped run', async () => {
    const controller = new AbortController()
    const { providers } = fakeProvider(Array.from({ length: 40 }, () => rotateOnly))
    const report = await runEvalReport({
      providers,
      model,
      quick: true,
      concurrency: 1,
      signal: controller.signal,
      onResult: (_r, done) => done === 2 && controller.abort()
    })
    expect(report.stopped).toBe(true)
    expect(report.ok).toBe(false)
    expect(report.overall.total).toBe(2)
  })
})
