import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ChatRequest, ProviderConfig } from '@shared/ai/types'
import {
  fixture,
  json,
  jsonFixture,
  ndjson,
  ndjsonFixture,
  startFakeProviderServer,
  type FakeProviderServer
} from '../fixtures/ai/server'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createOllamaAdapter, SHOW_CONCURRENCY } =
  await import('../../src/main/services/ai/providers/ollama')

const API_KEY = 'test-key-9f8e7d6c5b4a'

/** 1x1 transparent PNG. */
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
    'base64'
  )
)

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

describe('Ollama adapter (local fake server)', () => {
  let server: FakeProviderServer
  let sleeps: number[]
  let warn: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>

  function adapter(
    overrides: Partial<ProviderConfig> = {},
    apiKey: string | null = API_KEY
  ): ReturnType<typeof createOllamaAdapter> {
    return createOllamaAdapter({
      config: {
        id: 'local',
        kind: 'ollama',
        label: 'Local',
        baseUrl: server.url,
        enabled: true,
        ...overrides
      },
      apiKey: apiKey ?? undefined,
      fetch: (url, init) => fetch(url, init),
      logger: { warn },
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      retryBaseDelayMs: 100
    })
  }

  const request = (over: Partial<ChatRequest> = {}): ChatRequest => ({
    model: 'gemma3:27b',
    messages: [{ role: 'user', text: 'Rotate it' }],
    ...over
  })

  const chatRequests = (): FakeProviderServer['requests'] =>
    server.requests.filter((r) => r.path === '/api/chat')

  beforeEach(async () => {
    server = await startFakeProviderServer()
    sleeps = []
    warn = vi.fn()
    server.on('POST', '/api/show', (req, res) => {
      const model = (req.body as { model: string }).model
      if (model.startsWith('qwen3')) return jsonFixture('ollama/show-qwen3.json')(req, res)
      if (model.startsWith('gemma3')) return jsonFixture('ollama/show-gemma3.json')(req, res)
      return json(404, { error: `model '${model}' not found` })(req, res)
    })
  })

  afterEach(async () => {
    await server.close()
  })

  describe('chat', () => {
    it('streams plain text, usage and done', async () => {
      server.on('POST', '/api/chat', ndjsonFixture('ollama/chat-text.ndjson'))
      const events = await collect(adapter().chat(request(), new AbortController().signal))
      expect(events).toEqual([
        { type: 'text', delta: 'Rotated' },
        { type: 'text', delta: ' the texture' },
        { type: 'text', delta: ' 90 degrees.' },
        { type: 'usage', inputTokens: 42, outputTokens: 7 },
        { type: 'done', stopReason: 'end' }
      ])
      const [req] = chatRequests()
      expect(req!.headers['authorization']).toBe(`Bearer ${API_KEY}`)
      expect(req!.headers['content-type']).toBe('application/json')
      expect(req!.body).toEqual({
        model: 'gemma3:27b',
        messages: [{ role: 'user', content: 'Rotate it' }],
        stream: true
      })
    })

    it('streams thinking then text and sends think only for thinking models', async () => {
      server.on('POST', '/api/chat', ndjsonFixture('ollama/chat-thinking.ndjson'))
      const a = adapter()
      const events = await collect(
        a.chat(request({ model: 'qwen3:32b', think: true }), new AbortController().signal)
      )
      expect(events).toEqual([
        { type: 'thinking', delta: 'The user wants' },
        { type: 'thinking', delta: ' a left rotation.' },
        { type: 'text', delta: 'Done' },
        { type: 'text', delta: '!' },
        { type: 'usage', inputTokens: 120, outputTokens: 30 },
        { type: 'done', stopReason: 'end' }
      ])
      expect((chatRequests()[0]!.body as { think?: boolean }).think).toBe(true)

      // Thinking model, thinking not requested: explicit false (they think by default).
      await collect(a.chat(request({ model: 'qwen3:32b' }), new AbortController().signal))
      expect((chatRequests()[1]!.body as { think?: boolean }).think).toBe(false)
      // Non-thinking model: never sent (Ollama would answer 400).
      await collect(a.chat(request({ think: true }), new AbortController().signal))
      expect(chatRequests()[2]!.body).not.toHaveProperty('think')
      // /api/show is cached per model.
      expect(server.requests.filter((r) => r.path === '/api/show')).toHaveLength(2)
    })

    it('normalizes tool calls (object and string arguments, multiple calls, synthesized ids)', async () => {
      server.on('POST', '/api/chat', ndjsonFixture('ollama/chat-tool-calls.ndjson'))
      const events = await collect(
        adapter().chat(
          request({
            model: 'qwen3:32b',
            tools: [
              {
                name: 'rotate',
                description: 'Rotates the texture',
                parameters: { type: 'object', properties: { degrees: { type: 'number' } } }
              }
            ]
          }),
          new AbortController().signal
        )
      )
      const calls = events.filter((e) => e.type === 'tool_call').map((e) => e.call)
      expect(calls.map((c) => [c.name, c.args])).toEqual([
        ['rotate', { degrees: -90 }],
        ['draw_pixels', { pixels: [{ x: 1, y: 2, color: '#ff6a00' }] }],
        ['get_palette', {}]
      ])
      expect(calls[1]!.id).toBe('call_abc123')
      expect(calls[0]!.id).toMatch(/^call_[0-9a-f]{32}$/)
      expect(new Set(calls.map((c) => c.id)).size).toBe(3)
      expect(events[0]).toEqual({ type: 'thinking', delta: 'Rotate, then draw flames.' })
      expect(events.at(-2)).toEqual({ type: 'usage', inputTokens: 300, outputTokens: 45 })
      expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_calls' })
      expect((chatRequests()[0]!.body as { tools: unknown }).tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'rotate',
            description: 'Rotates the texture',
            parameters: { type: 'object', properties: { degrees: { type: 'number' } } }
          }
        }
      ])
    })

    it('converts images, assistant tool calls and tool results to the wire format', async () => {
      server.on('POST', '/api/chat', ndjsonFixture('ollama/chat-text.ndjson'))
      await collect(
        adapter().chat(
          request({
            temperature: 0.2,
            messages: [
              { role: 'system', text: 'You edit textures.' },
              { role: 'user', text: 'Look at this', images: [PNG] },
              {
                role: 'assistant',
                text: '',
                thinking: 'Rotate first.',
                toolCalls: [{ id: 'call_1', name: 'rotate', args: { degrees: 90 } }]
              },
              { role: 'tool', text: '{"ok":true}', toolCallId: 'call_1', toolName: 'rotate' }
            ]
          }),
          new AbortController().signal
        )
      )
      const body = chatRequests()[0]!.body as { messages: unknown[]; options: unknown }
      const base64 = Buffer.from(PNG).toString('base64')
      expect(base64.startsWith('data:')).toBe(false)
      expect(body.messages).toEqual([
        { role: 'system', content: 'You edit textures.' },
        { role: 'user', content: 'Look at this', images: [base64] },
        {
          role: 'assistant',
          content: '',
          thinking: 'Rotate first.',
          tool_calls: [{ id: 'call_1', function: { name: 'rotate', arguments: { degrees: 90 } } }]
        },
        { role: 'tool', content: '{"ok":true}', tool_name: 'rotate', tool_call_id: 'call_1' }
      ])
      expect(body.options).toEqual({ temperature: 0.2 })
    })

    it('maps done_reason length', async () => {
      server.on('POST', '/api/chat', ndjsonFixture('ollama/chat-length.ndjson'))
      const events = await collect(adapter().chat(request(), new AbortController().signal))
      expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'length' })
    })

    it('401 -> ai.unauthorized without retry', async () => {
      server.on('POST', '/api/chat', json(401, { error: 'unauthorized' }))
      await expect(
        collect(adapter().chat(request(), new AbortController().signal))
      ).rejects.toMatchObject({ code: 'ai.unauthorized' })
      expect(chatRequests()).toHaveLength(1)
      expect(sleeps).toEqual([])
    })

    it('429 is retried (honoring Retry-After) and then succeeds', async () => {
      server.on(
        'POST',
        '/api/chat',
        json(429, { error: 'rate limited' }, { 'Retry-After': '2' }),
        ndjsonFixture('ollama/chat-text.ndjson')
      )
      const events = await collect(adapter().chat(request(), new AbortController().signal))
      expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end' })
      expect(chatRequests()).toHaveLength(2)
      expect(sleeps).toEqual([2000])
    })

    it('429 after the retries -> ai.rateLimited with retryAfter', async () => {
      server.on('POST', '/api/chat', json(429, { error: 'too many' }, { 'Retry-After': '3' }))
      await expect(
        collect(adapter().chat(request(), new AbortController().signal))
      ).rejects.toMatchObject({ code: 'ai.rateLimited', params: { retryAfter: 3 } })
      expect(chatRequests()).toHaveLength(3)
    })

    it('500 -> exponential backoff, then ai.providerError with status and message', async () => {
      server.on('POST', '/api/chat', json(500, { error: 'internal error' }))
      await expect(
        collect(adapter().chat(request(), new AbortController().signal))
      ).rejects.toMatchObject({
        code: 'ai.providerError',
        params: { status: 500, message: 'internal error' }
      })
      expect(chatRequests()).toHaveLength(3)
      expect(sleeps).toEqual([100, 200])
    })

    it('404 -> ai.modelNotFound', async () => {
      server.on('POST', '/api/chat', json(404, { error: "model 'nope' not found" }))
      await expect(
        collect(adapter().chat(request({ model: 'nope' }), new AbortController().signal))
      ).rejects.toMatchObject({ code: 'ai.modelNotFound', params: { model: 'nope' } })
    })

    it('malformed line -> ai.invalidResponse after the valid events', async () => {
      server.on('POST', '/api/chat', ndjsonFixture('ollama/chat-malformed.ndjson'))
      const { events, error } = await collectUntilError(
        adapter().chat(request(), new AbortController().signal)
      )
      expect(events).toEqual([{ type: 'text', delta: 'Hello' }])
      expect(error).toMatchObject({ code: 'ai.invalidResponse' })
      // No retry once data was streamed.
      expect(chatRequests()).toHaveLength(1)
    })

    it('error object in the stream -> ai.providerError', async () => {
      server.on('POST', '/api/chat', ndjsonFixture('ollama/chat-stream-error.ndjson'))
      const { events, error } = await collectUntilError(
        adapter().chat(request(), new AbortController().signal)
      )
      expect(events).toEqual([{ type: 'text', delta: 'Hel' }])
      expect(error).toMatchObject({
        code: 'ai.providerError',
        params: { message: 'an error was encountered while running the model' }
      })
    })

    it('stream ending without done -> ai.invalidResponse', async () => {
      server.on('POST', '/api/chat', ndjson(fixture('ollama/chat-text.ndjson').split('\n')[0]!))
      const { error } = await collectUntilError(
        adapter().chat(request(), new AbortController().signal)
      )
      expect(error).toMatchObject({ code: 'ai.invalidResponse' })
    })

    it('abort mid-stream stops reading and closes the connection', async () => {
      let closed!: () => void
      const connectionClosed = new Promise<void>((r) => (closed = r))
      server.on('POST', '/api/chat', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
        res.write(fixture('ollama/chat-text.ndjson').split('\n')[0] + '\n')
        res.on('close', () => closed())
        // never ends on its own
      })
      const controller = new AbortController()
      const events: ChatEvent[] = []
      const run = (async (): Promise<void> => {
        for await (const e of adapter().chat(request(), controller.signal)) {
          events.push(e)
          controller.abort()
        }
      })()
      await expect(run).rejects.toMatchObject({ code: 'ai.aborted' })
      expect(events).toEqual([{ type: 'text', delta: 'Rotated' }])
      await connectionClosed
    })

    it('abort before the request -> ai.aborted, nothing sent', async () => {
      const controller = new AbortController()
      controller.abort()
      await expect(collect(adapter().chat(request(), controller.signal))).rejects.toMatchObject({
        code: 'ai.aborted'
      })
      expect(chatRequests()).toHaveLength(0)
    })

    it('network failure -> ai.network, logs never contain the key', async () => {
      const url = server.url
      await server.close()
      const a = createOllamaAdapter({
        config: { id: 'x', kind: 'ollama', label: 'X', baseUrl: url, enabled: true },
        apiKey: API_KEY,
        fetch: (u, init) => fetch(u, init),
        logger: { warn }
      })
      await expect(a.listModels()).rejects.toMatchObject({ code: 'ai.network' })
      expect(warn).toHaveBeenCalled()
      expect(JSON.stringify(warn.mock.calls)).not.toContain(API_KEY)
      expect(JSON.stringify(warn.mock.calls)).toContain('***')
      server = await startFakeProviderServer()
    })

    it('does not follow redirects (the key must not reach another host)', async () => {
      const other = await startFakeProviderServer()
      other.on('GET', '/api/tags', jsonFixture('ollama/tags.json'))
      server.on('GET', '/api/tags', (_req, res) => {
        res.writeHead(302, { Location: `${other.url}/api/tags` })
        res.end()
      })
      await expect(adapter().listModels()).rejects.toMatchObject({
        code: 'ai.providerError',
        params: { status: 302 }
      })
      expect(other.requests).toHaveLength(0)
      await other.close()
    })

    it('sends no Authorization header without a key (self-hosted)', async () => {
      server.on('POST', '/api/chat', ndjsonFixture('ollama/chat-text.ndjson'))
      await collect(adapter({}, null).chat(request(), new AbortController().signal))
      expect(chatRequests()[0]!.headers['authorization']).toBeUndefined()
    })

    it('sends extra headers but never lets them replace Authorization', async () => {
      expect(() => adapter({ extraHeaders: { Authorization: 'Bearer other' } })).toThrow()
      server.on('POST', '/api/chat', ndjsonFixture('ollama/chat-text.ndjson'))
      await collect(
        adapter({ extraHeaders: { 'X-Title': 'Blocksmith' } }).chat(
          request(),
          new AbortController().signal
        )
      )
      expect(chatRequests()[0]!.headers['x-title']).toBe('Blocksmith')
    })
  })

  describe('listModels', () => {
    it('lists /api/tags with /api/show capabilities and hint fallback', async () => {
      server.on('GET', '/api/tags', jsonFixture('ollama/tags.json'))
      const models = await adapter().listModels()
      expect(models).toEqual([
        {
          id: 'gemma3:27b',
          providerId: 'local',
          label: 'gemma3:27b',
          capabilities: { vision: true, tools: false, thinking: false },
          capabilitySource: 'provider',
          contextLength: 131072
        },
        {
          id: 'qwen2.5vl:7b',
          providerId: 'local',
          label: 'qwen2.5vl:7b',
          capabilities: { vision: true, tools: true },
          capabilitySource: 'hint'
        },
        {
          id: 'qwen3:32b',
          providerId: 'local',
          label: 'qwen3:32b',
          capabilities: { vision: false, tools: true, thinking: true },
          capabilitySource: 'provider',
          contextLength: 40960
        }
      ])
      const shows = server.requests.filter((r) => r.path === '/api/show')
      expect(shows.map((r) => r.body)).toEqual(
        expect.arrayContaining([{ model: 'gemma3:27b' }, { model: 'qwen3:32b' }])
      )
      expect(server.requests.find((r) => r.path === '/api/tags')!.headers['authorization']).toBe(
        `Bearer ${API_KEY}`
      )
      for (const m of models) {
        expect(m.pricing).toBeUndefined()
        expect(m.costTier).toBeUndefined()
      }
    })

    it('caches successful /api/show results and retries failed ones', async () => {
      server.on('GET', '/api/tags', jsonFixture('ollama/tags.json'))
      const a = adapter()
      await a.listModels()
      const first = server.requests.filter((r) => r.path === '/api/show').length
      expect(first).toBe(3)
      await a.listModels()
      const shows = server.requests.filter((r) => r.path === '/api/show').slice(first)
      expect(shows.map((r) => (r.body as { model: string }).model)).toEqual(['qwen2.5vl:7b'])
    })

    it('details: false skips /api/show', async () => {
      server.on('GET', '/api/tags', jsonFixture('ollama/tags.json'))
      const models = await adapter().listModels({ details: false })
      expect(models.every((m) => m.capabilitySource === 'hint')).toBe(true)
      expect(server.requests.filter((r) => r.path === '/api/show')).toHaveLength(0)
    })

    it(`limits concurrent /api/show requests to ${SHOW_CONCURRENCY}`, async () => {
      const names = Array.from({ length: 12 }, (_, i) => `model-${String(i).padStart(2, '0')}`)
      server.on(
        'GET',
        '/api/tags',
        json(200, { models: names.map((name) => ({ name, model: name })) })
      )
      let inFlight = 0
      let peak = 0
      server.on('POST', '/api/show', async (_req, res) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 15))
        inFlight--
        json(200, { capabilities: ['completion', 'tools'], model_info: {} })(_req, res)
      })
      const models = await adapter().listModels()
      expect(models.map((m) => m.id)).toEqual(names)
      expect(peak).toBeLessThanOrEqual(SHOW_CONCURRENCY)
      expect(peak).toBeGreaterThan(1)
    })

    it('unexpected /api/tags payload -> ai.invalidResponse; 404 -> ai.providerError', async () => {
      server.on('GET', '/api/tags', json(200, { nope: true }))
      await expect(adapter().listModels()).rejects.toMatchObject({ code: 'ai.invalidResponse' })
      server.on('GET', '/api/tags', json(404, { error: 'not found' }))
      await expect(adapter().listModels()).rejects.toMatchObject({
        code: 'ai.providerError',
        params: { status: 404 }
      })
    })
  })
})
