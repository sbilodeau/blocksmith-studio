import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ChatRequest, ProviderConfig } from '@shared/ai/types'
import {
  fixture,
  json,
  jsonFixture,
  sse,
  sseFixture,
  startFakeProviderServer,
  type FakeProviderServer
} from '../fixtures/ai/server'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createOpenAiAdapter, flavorOf, reasoningParams, toOpenAiMessages } =
  await import('../../src/main/services/ai/providers/openai')

const API_KEY = 'sk-test-0123456789abcdef'
const PNG = Uint8Array.from([137, 80, 78, 71])

async function collect(iterable: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = []
  for await (const e of iterable) events.push(e)
  return events
}

async function collectUntilError(
  iterable: AsyncIterable<ChatEvent>
): Promise<{ events: ChatEvent[]; error: unknown }> {
  const events: ChatEvent[] = []
  try {
    for await (const e of iterable) events.push(e)
  } catch (error) {
    return { events, error }
  }
  return { events, error: undefined }
}

const REQUEST: ChatRequest = { model: 'gpt-4o-mini', messages: [{ role: 'user', text: 'salut' }] }

describe('OpenAI-compatible adapter (local fake server)', () => {
  let server: FakeProviderServer
  let warn: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>

  function adapter(
    overrides: Partial<ProviderConfig> = {}
  ): ReturnType<typeof createOpenAiAdapter> {
    return createOpenAiAdapter({
      config: {
        id: 'oai',
        kind: 'openai-compatible',
        label: 'Test',
        baseUrl: `${server.url}/v1`,
        enabled: true,
        ...overrides
      },
      apiKey: API_KEY,
      fetch: (url, init) => fetch(url, init),
      logger: { warn },
      sleep: async () => undefined,
      retryBaseDelayMs: 1
    })
  }

  beforeEach(async () => {
    server = await startFakeProviderServer()
    warn = vi.fn()
  })
  afterEach(async () => {
    await server.close()
  })

  describe('chat', () => {
    it('streams text, then usage and done; sends stream options and the key', async () => {
      server.on('POST', '/v1/chat/completions', sseFixture('openai/chat-text.sse'))
      const events = await collect(adapter().chat(REQUEST, new AbortController().signal))
      expect(events).toEqual([
        { type: 'text', delta: 'Bonjour' },
        { type: 'text', delta: ' !' },
        { type: 'usage', inputTokens: 120, outputTokens: 8 },
        { type: 'done', stopReason: 'end' }
      ])
      const req = server.requests[0]!
      expect(req.headers['authorization']).toBe(`Bearer ${API_KEY}`)
      expect(req.body).toMatchObject({
        model: 'gpt-4o-mini',
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'user', content: 'salut' }]
      })
      expect(req.body).not.toHaveProperty('reasoning_effort')
    })

    it('assembles tool calls streamed in fragments', async () => {
      server.on('POST', '/v1/chat/completions', sseFixture('openai/chat-tool-calls.sse'))
      const events = await collect(
        adapter().chat(
          { ...REQUEST, tools: [{ name: 'rotate', description: 'r', parameters: {} }] },
          new AbortController().signal
        )
      )
      expect(events).toEqual([
        {
          type: 'tool_call',
          call: {
            id: 'call_rot',
            name: 'rotate',
            args: { degrees: 90, direction: 'counterclockwise' }
          }
        },
        {
          type: 'tool_call',
          call: {
            id: 'call_px',
            name: 'set_pixels',
            args: { pixels: [{ x: 0, y: 0, color: '#ff0000' }] }
          }
        },
        { type: 'usage', inputTokens: 900, outputTokens: 40 },
        { type: 'done', stopReason: 'tool_calls' }
      ])
      expect((server.requests[0]!.body as { tools: unknown[] }).tools).toEqual([
        { type: 'function', function: { name: 'rotate', description: 'r', parameters: {} } }
      ])
    })

    it('OpenRouter: reasoning once (not twice), comments skipped, cost from usage', async () => {
      server.on('GET', '/api/v1/models', jsonFixture('openai/models-openrouter.json'))
      server.on(
        'POST',
        '/api/v1/chat/completions',
        sseFixture('openai/chat-openrouter-reasoning.sse')
      )
      // The fake server stands in for openrouter.ai: flavor detection uses the real host only.
      const a = adapter({ baseUrl: `${server.url}/api/v1` })
      const events = await collect(
        a.chat({ ...REQUEST, model: 'qwen/qwen3-32b' }, new AbortController().signal)
      )
      expect(events.filter((e) => e.type === 'thinking')).toEqual([
        { type: 'thinking', delta: 'The user wants' },
        { type: 'thinking', delta: ' a flip.' }
      ])
      expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', delta: 'Done.' }])
      // Generic flavor: the cost field is only trusted from openrouter.ai.
      expect(events.find((e) => e.type === 'usage')).toEqual({
        type: 'usage',
        inputTokens: 300,
        outputTokens: 25
      })
    })

    it('openrouter.ai: reasoning effort for thinking models (from /models) and cost in USD', async () => {
      server.on('GET', '/api/v1/models', jsonFixture('openai/models-openrouter.json'))
      server.on(
        'POST',
        '/api/v1/chat/completions',
        sseFixture('openai/chat-openrouter-reasoning.sse')
      )
      const a = createOpenAiAdapter({
        config: {
          id: 'or',
          kind: 'openai-compatible',
          label: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          enabled: true
        },
        apiKey: API_KEY,
        // Same requests, served locally.
        fetch: (url, init) => fetch(url.replace('https://openrouter.ai', server.url), init),
        logger: { warn }
      })
      const signal = new AbortController().signal
      const events = await collect(
        a.chat({ ...REQUEST, model: 'qwen/qwen3-32b', think: 'low' }, signal)
      )
      expect(events.find((e) => e.type === 'usage')).toEqual({
        type: 'usage',
        inputTokens: 300,
        outputTokens: 25,
        costUsd: 0.00012
      })
      await collect(a.chat({ ...REQUEST, model: 'openai/gpt-4o', think: 'low' }, signal))
      const chats = server.requests.filter((r) => r.method === 'POST')
      expect((chats[0]!.body as Record<string, unknown>)['reasoning']).toEqual({ effort: 'low' })
      expect(chats[1]!.body).not.toHaveProperty('reasoning')
      // The model list is fetched once to learn which models can think.
      expect(server.requests.filter((r) => r.method === 'GET')).toHaveLength(1)
    })

    it('DeepSeek-style reasoning_content and finish_reason length', async () => {
      server.on('POST', '/v1/chat/completions', sseFixture('openai/chat-deepseek-reasoning.sse'))
      const events = await collect(adapter().chat(REQUEST, new AbortController().signal))
      expect(events).toEqual([
        { type: 'thinking', delta: 'Think' },
        { type: 'thinking', delta: 'ing...' },
        { type: 'text', delta: 'OK' },
        { type: 'done', stopReason: 'length' }
      ])
    })

    it('converts images, assistant tool calls and tool results', async () => {
      server.on('POST', '/v1/chat/completions', sseFixture('openai/chat-text.sse'))
      await collect(
        adapter().chat(
          {
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', text: 'sys' },
              { role: 'user', text: 'look', images: [PNG] },
              {
                role: 'assistant',
                thinking: 'secret',
                toolCalls: [{ id: 'c1', name: 'flip', args: { axis: 'horizontal' } }]
              },
              { role: 'tool', toolCallId: 'c1', toolName: 'flip', text: '{"ok":true}' }
            ]
          },
          new AbortController().signal
        )
      )
      expect((server.requests[0]!.body as { messages: unknown }).messages).toEqual([
        { role: 'system', content: 'sys' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw==' } }
          ]
        },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'flip', arguments: '{"axis":"horizontal"}' }
            }
          ]
        },
        { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' }
      ])
    })

    it('error event in the stream -> ai.providerError after the earlier text', async () => {
      server.on('POST', '/v1/chat/completions', sseFixture('openai/chat-stream-error.sse'))
      const { events, error } = await collectUntilError(
        adapter().chat(REQUEST, new AbortController().signal)
      )
      expect(events).toEqual([{ type: 'text', delta: 'Hel' }])
      expect(error).toMatchObject({
        code: 'ai.providerError',
        params: { message: 'Provider returned error' }
      })
    })

    it('stream without any finished choice -> ai.invalidResponse; bad JSON too', async () => {
      server.on(
        'POST',
        '/v1/chat/completions',
        sse(
          fixture('openai/chat-text.sse')
            .replace(/\r\n/g, '\n')
            .split('\n\n')
            .slice(0, 2)
            .join('\n\n')
        ),
        sse('data: {not json\n\n')
      )
      const first = await collectUntilError(adapter().chat(REQUEST, new AbortController().signal))
      expect(first.error).toMatchObject({ code: 'ai.invalidResponse' })
      const second = await collectUntilError(adapter().chat(REQUEST, new AbortController().signal))
      expect(second.error).toMatchObject({ code: 'ai.invalidResponse' })
    })

    it('401 -> ai.unauthorized; 404 -> ai.modelNotFound; OpenAI error message on 400', async () => {
      server.on(
        'POST',
        '/v1/chat/completions',
        json(401, { error: { message: 'Incorrect API key provided' } }),
        json(404, { error: { message: 'The model does not exist' } }),
        json(400, {
          error: { message: `Unrecognized request argument supplied: think ${API_KEY}` }
        })
      )
      const signal = new AbortController().signal
      expect((await collectUntilError(adapter().chat(REQUEST, signal))).error).toMatchObject({
        code: 'ai.unauthorized'
      })
      expect((await collectUntilError(adapter().chat(REQUEST, signal))).error).toMatchObject({
        code: 'ai.modelNotFound',
        params: { model: 'gpt-4o-mini' }
      })
      const bad = (await collectUntilError(adapter().chat(REQUEST, signal))).error as {
        params: { message: string }
      }
      expect(bad).toMatchObject({ code: 'ai.providerError', params: { status: 400 } })
      expect(bad.params.message).not.toContain(API_KEY)
    })

    it('sends reasoning_effort for thinking models on generic servers only when asked', async () => {
      server.on('POST', '/v1/chat/completions', sseFixture('openai/chat-text.sse'))
      const signal = new AbortController().signal
      await collect(adapter().chat({ ...REQUEST, model: 'qwen3:32b', think: 'high' }, signal))
      await collect(adapter().chat({ ...REQUEST, model: 'qwen3:32b', think: false }, signal))
      await collect(adapter().chat({ ...REQUEST, model: 'gpt-4o-mini', think: 'high' }, signal))
      expect(
        server.requests.map((r) => (r.body as Record<string, unknown>)['reasoning_effort'])
      ).toEqual(['high', undefined, undefined])
    })
  })

  describe('listModels', () => {
    it('OpenAI /models: drops non-chat models and duplicates, hints capabilities and prices', async () => {
      server.on('GET', '/v1/models', jsonFixture('openai/models-openai.json'))
      const models = await adapter().listModels()
      expect(models.map((m) => m.id)).toEqual(['gpt-4o-mini', 'gpt-5', 'o3'])
      expect(models[0]).toMatchObject({
        providerId: 'oai',
        label: 'gpt-4o-mini',
        capabilities: { vision: true, tools: true },
        capabilitySource: 'hint',
        pricing: { inPerMTok: 0.15, outPerMTok: 0.6, source: 'hint' }
      })
    })

    it('OpenRouter /models: capabilities, context and prices from the provider', async () => {
      server.on('GET', '/api/v1/models', jsonFixture('openai/models-openrouter.json'))
      const models = await adapter({ baseUrl: `${server.url}/api/v1` }).listModels()
      const byId = Object.fromEntries(models.map((m) => [m.id, m]))
      expect(byId['qwen/qwen3-32b']).toMatchObject({
        label: 'Qwen: Qwen3 32B (qwen/qwen3-32b)',
        contextLength: 40960,
        capabilities: { vision: false, tools: true, thinking: true },
        capabilitySource: 'provider',
        pricing: { inPerMTok: 0.08, outPerMTok: 0.24, source: 'provider' }
      })
      expect(byId['openai/gpt-4o']).toMatchObject({
        capabilities: { vision: true, tools: true, thinking: false },
        pricing: { inPerMTok: 2.5, outPerMTok: 10, source: 'provider' }
      })
      // Variable price (router): unknown, not guessed. Free models: price 0.
      expect(byId['openrouter/auto']!.pricing).toBeUndefined()
      expect(byId['meta-llama/llama-3.3-8b-instruct:free']).toMatchObject({
        capabilities: { tools: false },
        pricing: { inPerMTok: 0, outPerMTok: 0 }
      })
    })

    it('unexpected payload -> ai.invalidResponse', async () => {
      server.on('GET', '/v1/models', json(200, { models: [] }))
      await expect(adapter().listModels()).rejects.toMatchObject({ code: 'ai.invalidResponse' })
    })
  })
})

describe('OpenAI-compatible helpers', () => {
  it('detects the server flavor from the host', () => {
    expect(flavorOf('https://api.openai.com/v1')).toBe('openai')
    expect(flavorOf('https://openrouter.ai/api/v1')).toBe('openrouter')
    expect(flavorOf('http://localhost:11434/v1')).toBe('generic')
  })

  it('maps the reasoning level per flavor', () => {
    expect(reasoningParams('openai', 'gpt-5-mini', 'low', false)).toEqual({
      reasoning_effort: 'low'
    })
    expect(reasoningParams('openai', 'gpt-4o', 'high', true)).toEqual({})
    expect(reasoningParams('openrouter', 'qwen/qwen3-32b', true, true)).toEqual({
      reasoning: { effort: 'medium' }
    })
    expect(reasoningParams('openrouter', 'openai/gpt-4o', 'high', false)).toEqual({})
    expect(reasoningParams('generic', 'm', false, true)).toEqual({})
  })

  it('keeps unparsable tool arguments as strings for the runtime to report', () => {
    expect(
      toOpenAiMessages([
        { role: 'assistant', text: 'x', toolCalls: [{ id: 'a', name: 'f', args: '{bad' }] }
      ])
    ).toEqual([
      {
        role: 'assistant',
        content: 'x',
        tool_calls: [{ id: 'a', type: 'function', function: { name: 'f', arguments: '{bad' } }]
      }
    ])
  })
})
