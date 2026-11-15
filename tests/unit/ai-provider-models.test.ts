import { describe, expect, it, vi } from 'vitest'
import type { ModelInfo } from '@shared/ai/types'
import { applySettingsPatch, defaultSettings, SettingsPatchSchema } from '@shared/model/settings'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { readSse } = await import('../../src/main/services/ai/providers/sse')
const { priceFromHints, costFromUsage } =
  await import('../../src/main/services/ai/providers/pricing')
const { decorateModels } = await import('../../src/main/services/ai/providers/registry')

function stream(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p))
      c.close()
    }
  })
}

async function all(body: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = []
  for await (const d of readSse(body)) out.push(d)
  return out
}

describe('readSse', () => {
  it('splits events across chunks, skips comments and other fields, stops at [DONE]', async () => {
    expect(
      await all(
        stream([
          ': keep-alive\n\nevent: message\nid: 1\nda',
          'ta: {"a":1}\n\ndata:{"b":2}\r\n\r\n',
          'data: first\ndata: second\n\ndata: [DONE]\n\ndata: after\n\n'
        ])
      )
    ).toEqual(['{"a":1}', '{"b":2}', 'first\nsecond'])
  })

  it('yields a last event without its blank line, and nothing for an empty body', async () => {
    expect(await all(stream(['data: x\n\ndata: tail']))).toEqual(['x', 'tail'])
    expect(await all(stream([]))).toEqual([])
  })

  it('throws ai.invalidResponse without a body', async () => {
    await expect(all(null as unknown as ReadableStream<Uint8Array>)).rejects.toMatchObject({
      code: 'ai.invalidResponse'
    })
  })
})

describe('price hints', () => {
  it('matches exact families (and dated snapshots), ignoring a vendor prefix', () => {
    expect(priceFromHints('gpt-4o')).toEqual({ inPerMTok: 2.5, outPerMTok: 10 })
    expect(priceFromHints('openai/gpt-4o-mini')).toEqual({ inPerMTok: 0.15, outPerMTok: 0.6 })
    expect(priceFromHints('gpt-4o-2024-08-06')).toEqual({ inPerMTok: 2.5, outPerMTok: 10 })
    expect(priceFromHints('gpt-5-mini')).toEqual({ inPerMTok: 0.25, outPerMTok: 2 })
    expect(priceFromHints('gpt-4o-audio-preview')).toBeUndefined()
    expect(priceFromHints('qwen3:32b')).toBeUndefined()
  })

  it('computes a request cost from tokens', () => {
    expect(
      costFromUsage(
        { inputTokens: 1_000_000, outputTokens: 500_000 },
        { inPerMTok: 2, outPerMTok: 8 }
      )
    ).toBe(6)
    expect(costFromUsage({ inputTokens: 10 }, undefined)).toBeUndefined()
    expect(costFromUsage({}, { inPerMTok: 1, outPerMTok: 1 })).toBeUndefined()
  })
})

describe('decorateModels', () => {
  const base: ModelInfo[] = [
    {
      id: 'a',
      providerId: 'p',
      label: 'a',
      capabilities: { tools: false },
      capabilitySource: 'hint'
    },
    {
      id: 'b',
      providerId: 'p',
      label: 'b',
      capabilities: { tools: true },
      pricing: { inPerMTok: 0.1, outPerMTok: 0.4, source: 'provider' }
    },
    {
      id: 'c',
      providerId: 'p',
      label: 'c',
      capabilities: {},
      pricing: { inPerMTok: 5, outPerMTok: 20, source: 'hint' }
    }
  ]

  it('adds cost tiers from the blended price and hides them when unknown', () => {
    const out = decorateModels(base, [])
    expect(out.map((m) => m.costTier)).toEqual([undefined, 1, 3])
  })

  it('applies user capabilities and prices without touching the input', () => {
    const out = decorateModels(base, [
      { providerId: 'p', modelId: 'a', capabilities: { tools: true, vision: true } },
      { providerId: 'p', modelId: 'b', pricing: { inPerMTok: 2, outPerMTok: 4 } },
      { providerId: 'other', modelId: 'c', pricing: { inPerMTok: 0, outPerMTok: 0 } }
    ])
    expect(out[0]).toMatchObject({
      capabilities: { tools: true, vision: true },
      capabilitySource: 'user'
    })
    expect(out[1]).toMatchObject({
      pricing: { inPerMTok: 2, outPerMTok: 4, source: 'user' },
      costTier: 2
    })
    expect(out[2]!.costTier).toBe(3)
    expect(base[0]!.capabilities).toEqual({ tools: false })
  })

  it('uses custom tier limits', () => {
    expect(decorateModels(base, [], { low: 0.01, high: 0.2 }).map((m) => m.costTier)).toEqual([
      undefined,
      3,
      3
    ])
  })
})

describe('AI model settings', () => {
  it('defaults: no overrides, $1/$10 tiers, tool models only', () => {
    const s = defaultSettings()
    expect(s.ai.modelOverrides).toEqual([])
    expect(s.ai.costTiers).toEqual({ low: 1, high: 10 })
    expect(s.ai.showAllModels).toBe(false)
  })

  it('upserts and removes a model override', () => {
    let s = defaultSettings()
    const patch = (p: unknown): void => {
      s = applySettingsPatch(s, SettingsPatchSchema.parse(p))
    }
    patch({
      aiModelOverride: { providerId: 'p', modelId: 'm', pricing: { inPerMTok: 1, outPerMTok: 2 } }
    })
    patch({ aiModelOverride: { providerId: 'p', modelId: 'm', capabilities: { vision: true } } })
    expect(s.ai.modelOverrides).toEqual([
      { providerId: 'p', modelId: 'm', capabilities: { vision: true } }
    ])
    patch({ aiModelOverride: { providerId: 'p', modelId: 'm', capabilities: {} } })
    expect(s.ai.modelOverrides).toEqual([])
    patch({ aiCostTiers: { low: 0.5, high: 5 }, aiShowAllModels: true })
    expect(s.ai.costTiers).toEqual({ low: 0.5, high: 5 })
    expect(s.ai.showAllModels).toBe(true)
  })

  it('rejects inverted tier limits and negative prices', () => {
    expect(SettingsPatchSchema.safeParse({ aiCostTiers: { low: 10, high: 1 } }).success).toBe(false)
    expect(
      SettingsPatchSchema.safeParse({
        aiModelOverride: {
          providerId: 'p',
          modelId: 'm',
          pricing: { inPerMTok: -1, outPerMTok: 1 }
        }
      }).success
    ).toBe(false)
  })
})
