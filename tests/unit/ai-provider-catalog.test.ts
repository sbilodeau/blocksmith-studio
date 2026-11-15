import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { capabilitiesFromHints, capabilitiesFromOllama } =
  await import('../../src/main/services/ai/providers/capabilities')
const { costTierFor, blendedPricePerMTok } =
  await import('../../src/main/services/ai/providers/cost')
const { assertSafeBaseUrl, joinUrl, parseRetryAfter, redact, redactHeaders, isLoopbackUrl } =
  await import('../../src/main/services/ai/providers/http')

describe('capability hints', () => {
  it.each([
    ['qwen2.5vl:7b', { vision: true, tools: true }],
    ['qwen3-vl:235b-cloud', { vision: true, tools: true, thinking: true }],
    ['llama3.2-vision:11b', { vision: true, tools: true }],
    ['llava:13b', { vision: true }],
    ['gemma3:27b', { vision: true }],
    ['gpt-oss:120b-cloud', { tools: true, thinking: true }],
    ['deepseek-v3.1:671b-cloud', { tools: true, thinking: true }],
    ['kimi-k2:1t-cloud', { tools: true }],
    ['mistral-small3.2:24b', { vision: true, tools: true }],
    ['tinyllama:1.1b', {}]
  ])('%s', (id, expected) => {
    expect(capabilitiesFromHints(id)).toEqual(expected)
  })

  it('does not treat "vl" inside a word as vision', () => {
    expect(capabilitiesFromHints('devlin:7b').vision).toBeUndefined()
  })

  it('maps Ollama /api/show capabilities', () => {
    expect(capabilitiesFromOllama(['completion', 'tools', 'vision', 'thinking'])).toEqual({
      vision: true,
      tools: true,
      thinking: true
    })
    expect(capabilitiesFromOllama(['completion'])).toEqual({
      vision: false,
      tools: false,
      thinking: false
    })
  })
})

describe('costTierFor', () => {
  it('uses the blended price (in + 3 x out) / 4 per 1M tokens', () => {
    expect(blendedPricePerMTok({ inPerMTok: 2, outPerMTok: 6 })).toBe(5)
  })

  it.each([
    [{ inPerMTok: 0, outPerMTok: 0 }, 1],
    [{ inPerMTok: 0.15, outPerMTok: 0.6 }, 1],
    [{ inPerMTok: 1, outPerMTok: 1 }, 2],
    [{ inPerMTok: 2.5, outPerMTok: 10 }, 2],
    [{ inPerMTok: 10, outPerMTok: 10 }, 2],
    [{ inPerMTok: 15, outPerMTok: 75 }, 3]
  ])('%o -> %i', (pricing, tier) => {
    expect(costTierFor({ ...pricing, source: 'provider' })).toBe(tier)
  })

  it('is undefined when the price is unknown or invalid', () => {
    expect(costTierFor(undefined)).toBeUndefined()
    expect(costTierFor({ inPerMTok: Number.NaN, outPerMTok: 1 })).toBeUndefined()
    expect(costTierFor({ inPerMTok: -1, outPerMTok: 1 })).toBeUndefined()
  })

  it('accepts custom thresholds', () => {
    expect(costTierFor({ inPerMTok: 1, outPerMTok: 1 }, { low: 2, high: 4 })).toBe(1)
  })
})

describe('provider URL safety', () => {
  it('accepts https and loopback http only', () => {
    expect(assertSafeBaseUrl('https://ollama.com').origin).toBe('https://ollama.com')
    expect(() => assertSafeBaseUrl('http://localhost:11434')).not.toThrow()
    expect(() => assertSafeBaseUrl('http://127.0.0.1:8080/v1')).not.toThrow()
    for (const bad of [
      'http://ollama.com',
      'http://192.168.1.5:11434',
      'ftp://ollama.com',
      'https://user:pass@ollama.com',
      'https://ollama.com/?key=abc',
      'not a url'
    ]) {
      expect(() => assertSafeBaseUrl(bad), bad).toThrow(
        expect.objectContaining({ code: 'ai.insecureBaseUrl' })
      )
    }
    expect(isLoopbackUrl('http://localhost:1')).toBe(true)
    expect(isLoopbackUrl('https://ollama.com')).toBe(false)
  })

  it('joins paths onto the base path and stays on the same origin', () => {
    expect(joinUrl(new URL('https://ollama.com'), '/api/chat')).toBe('https://ollama.com/api/chat')
    expect(joinUrl(new URL('https://example.com/proxy/'), '/api/tags')).toBe(
      'https://example.com/proxy/api/tags'
    )
    expect(joinUrl(new URL('https://ollama.com'), '//evil.com/x')).toBe(
      'https://ollama.com//evil.com/x'
    )
  })

  it('redacts secrets and auth headers', () => {
    expect(redact('bad key sk-1 sk-1', 'sk-1')).toBe('bad key *** ***')
    expect(redactHeaders({ Authorization: 'Bearer x', 'X-Title': 't' })).toEqual({
      Authorization: '***',
      'X-Title': 't'
    })
  })

  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('3')).toBe(3)
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 0)).toBe(10)
    expect(parseRetryAfter('soon')).toBeUndefined()
  })
})
