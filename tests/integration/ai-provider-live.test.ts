import { describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '@shared/ai/types'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createOllamaAdapter } = await import('../../src/main/services/ai/providers/ollama')

/** Live check against Ollama Cloud. Skipped unless OLLAMA_API_KEY is set (never commit a key). */
const apiKey = process.env['OLLAMA_API_KEY']
const PREFERRED_SMALL_MODELS = ['gpt-oss:20b', 'gemma3:4b', 'gemma3:12b', 'ministral-3:3b']

describe.skipIf(!apiKey)('Ollama Cloud (live)', () => {
  const adapter = createOllamaAdapter({
    config: {
      id: 'ollama-cloud',
      kind: 'ollama',
      label: 'Ollama Cloud',
      baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'https://ollama.com',
      enabled: true
    },
    apiKey,
    fetch: (url, init) => fetch(url, init)
  })

  it('lists models and runs a one-line chat', { timeout: 120_000 }, async () => {
    const models = await adapter.listModels()
    expect(models.length).toBeGreaterThan(0)
    const pick =
      process.env['OLLAMA_TEST_MODEL'] ??
      PREFERRED_SMALL_MODELS.find((id) => models.some((m) => m.id === id)) ??
      models[0]!.id
    console.info(`[live] ${models.length} models; chatting with ${pick}`)
    console.info(
      models
        .map((m) => `${m.id} ${m.capabilitySource} ${JSON.stringify(m.capabilities)}`)
        .join('\n')
    )

    const events: ChatEvent[] = []
    for await (const e of adapter.chat(
      { model: pick, messages: [{ role: 'user', text: 'Reply with the single word: ok' }] },
      AbortSignal.timeout(90_000)
    )) {
      events.push(e)
    }
    const text = events
      .filter((e) => e.type === 'text')
      .map((e) => e.delta)
      .join('')
    expect(text.length).toBeGreaterThan(0)
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })
})
