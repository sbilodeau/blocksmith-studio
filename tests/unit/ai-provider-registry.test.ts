import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelInfo, ProviderConfig } from '@shared/ai/types'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createProviderRegistry, MODEL_CACHE_TTL_MS } =
  await import('../../src/main/services/ai/providers/registry')
type Registry = ReturnType<typeof createProviderRegistry>
type Factories = NonNullable<Parameters<typeof createProviderRegistry>[0]['factories']>
type ListOptions = { signal?: AbortSignal; details?: boolean }

const model = (providerId: string, id: string): ModelInfo => ({
  id,
  providerId,
  label: id,
  capabilities: { tools: true },
  capabilitySource: 'hint'
})

describe('ProviderRegistry', () => {
  let providers: ProviderConfig[]
  let keys: Map<string, string>
  let clock: number
  let created: Array<{ id: string; apiKey?: string }>
  let listModels: ReturnType<
    typeof vi.fn<(id: string, options?: ListOptions) => Promise<ModelInfo[]>>
  >
  let warn: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>
  let registry: Registry

  function make(factories?: Factories): Registry {
    return createProviderRegistry({
      getProviders: () => providers,
      secrets: {
        get: async (id) => keys.get(id),
        has: async (id) => keys.has(id)
      },
      fetch: vi.fn(),
      logger: { warn },
      now: () => clock,
      factories: factories ?? {
        ollama: ({ config, apiKey }) => {
          created.push({ id: config.id, apiKey })
          return {
            providerId: config.id,
            listModels: (options?: ListOptions) => listModels(config.id, options),
            chat: () => {
              throw new Error('unused')
            }
          }
        }
      }
    })
  }

  beforeEach(() => {
    providers = [
      { id: 'cloud', kind: 'ollama', label: 'Cloud', baseUrl: 'https://ollama.com', enabled: true },
      { id: 'off', kind: 'ollama', label: 'Off', baseUrl: 'https://ollama.com', enabled: false },
      {
        id: 'nokey',
        kind: 'ollama',
        label: 'No key',
        baseUrl: 'https://ollama.com',
        enabled: true
      },
      {
        id: 'local',
        kind: 'ollama',
        label: 'Local',
        baseUrl: 'http://localhost:11434',
        enabled: true
      }
    ]
    keys = new Map([
      ['cloud', 'k-cloud'],
      ['off', 'k-off']
    ])
    clock = 1_000_000
    created = []
    warn = vi.fn()
    listModels = vi.fn(async (id: string) => [model(id, 'qwen3:32b'), model(id, 'gemma3:27b')])
    registry = make()
  })

  describe('getAdapter', () => {
    it('builds the adapter with the decrypted key and caches it', async () => {
      const a = await registry.getAdapter('cloud')
      expect(a.providerId).toBe('cloud')
      expect(created).toEqual([{ id: 'cloud', apiKey: 'k-cloud' }])
      expect(await registry.getAdapter('cloud')).toBe(a)
      expect(created).toHaveLength(1)
    })

    it('rebuilds after invalidate or a config change', async () => {
      const a = await registry.getAdapter('cloud')
      registry.invalidate('cloud')
      const b = await registry.getAdapter('cloud')
      expect(b).not.toBe(a)
      providers[0] = { ...providers[0]!, label: 'Renamed' }
      expect(await registry.getAdapter('cloud')).not.toBe(b)
      expect(created).toHaveLength(3)
    })

    it('errors: not found, disabled, no key, unsupported kind, insecure URL', async () => {
      await expect(registry.getAdapter('missing')).rejects.toMatchObject({
        code: 'ai.providerNotFound',
        params: { providerId: 'missing' }
      })
      await expect(registry.getAdapter('off')).rejects.toMatchObject({
        code: 'ai.providerDisabled'
      })
      await expect(registry.getAdapter('nokey')).rejects.toMatchObject({ code: 'ai.noApiKey' })
      providers.push({
        id: 'oai',
        kind: 'openai-compatible',
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true
      })
      keys.set('oai', 'k')
      await expect(registry.getAdapter('oai')).rejects.toMatchObject({
        code: 'ai.providerKindUnsupported',
        params: { kind: 'openai-compatible' }
      })
      providers.push({
        id: 'plain',
        kind: 'ollama',
        label: 'Plain',
        baseUrl: 'http://example.com',
        enabled: true
      })
      keys.set('plain', 'k')
      await expect(registry.getAdapter('plain')).rejects.toMatchObject({
        code: 'ai.insecureBaseUrl'
      })
    })

    it('loopback providers work without a key', async () => {
      await registry.getAdapter('local')
      expect(created).toEqual([{ id: 'local', apiKey: undefined }])
    })

    it('the real factory table knows ollama', async () => {
      const real = createProviderRegistry({
        getProviders: () => providers,
        secrets: { get: async (id) => keys.get(id), has: async (id) => keys.has(id) },
        fetch: vi.fn()
      })
      const a = await real.getAdapter('cloud')
      expect(a.providerId).toBe('cloud')
    })
  })

  describe('model list cache', () => {
    it('caches for 10 minutes; refresh bypasses it', async () => {
      await registry.listModels('cloud')
      await registry.listModels('cloud')
      expect(listModels).toHaveBeenCalledTimes(1)
      clock += MODEL_CACHE_TTL_MS - 1
      await registry.listModels('cloud')
      expect(listModels).toHaveBeenCalledTimes(1)
      clock += 2
      await registry.listModels('cloud')
      expect(listModels).toHaveBeenCalledTimes(2)
      await registry.listModels('cloud', { refresh: true })
      expect(listModels).toHaveBeenCalledTimes(3)
    })

    it('shares one in-flight request', async () => {
      const [a, b] = await Promise.all([registry.listModels('cloud'), registry.listModels('cloud')])
      expect(a).toBe(b)
      expect(listModels).toHaveBeenCalledTimes(1)
    })

    it('is dropped by invalidate and does not cache failures', async () => {
      await registry.listModels('cloud')
      registry.invalidate('cloud')
      await registry.listModels('cloud')
      expect(listModels).toHaveBeenCalledTimes(2)
      // A failed refresh keeps the previous list.
      listModels.mockRejectedValueOnce(new Error('down'))
      await expect(registry.listModels('cloud', { refresh: true })).rejects.toThrow('down')
      expect(await registry.listModels('cloud')).toHaveLength(2)
      expect(listModels).toHaveBeenCalledTimes(3)
      // Without a previous list, the next call tries again.
      registry.invalidate()
      listModels.mockRejectedValueOnce(new Error('down'))
      await expect(registry.listModels('cloud')).rejects.toThrow('down')
      await registry.listModels('cloud')
      expect(listModels).toHaveBeenCalledTimes(5)
    })

    it('getModel finds a model in the (cached) list, undefined otherwise', async () => {
      expect(await registry.getModel({ providerId: 'cloud', modelId: 'qwen3:32b' })).toMatchObject({
        id: 'qwen3:32b',
        providerId: 'cloud'
      })
      expect(await registry.getModel({ providerId: 'cloud', modelId: 'nope' })).toBeUndefined()
      expect(listModels).toHaveBeenCalledTimes(1)
      expect(await registry.getModel({ providerId: 'nokey', modelId: 'x' })).toBeUndefined()
      expect(warn).toHaveBeenCalled()
    })

    it('listAllModels covers enabled, usable providers and skips failures', async () => {
      listModels.mockImplementation(async (id: string) => {
        if (id === 'local') throw new Error('down')
        return [model(id, 'm')]
      })
      const all = await registry.listAllModels()
      expect(all.map((m) => m.providerId)).toEqual(['cloud'])
      expect(listModels.mock.calls.map((c) => c[0]).sort()).toEqual(['cloud', 'local'])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('local'), expect.anything())
    })
  })

  describe('testProvider', () => {
    it('lists models without details and returns the count', async () => {
      expect(await registry.testProvider('cloud')).toEqual({ ok: true, modelCount: 2 })
      expect(listModels.mock.calls[0]![1]).toMatchObject({ details: false })
      expect(listModels.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal)
    })

    it('returns error codes instead of throwing', async () => {
      expect(await registry.testProvider('nokey')).toEqual({
        ok: false,
        error: { code: 'ai.noApiKey', params: { providerId: 'nokey' } }
      })
      expect(await registry.testProvider('missing')).toMatchObject({
        ok: false,
        error: { code: 'ai.providerNotFound' }
      })
      // A disabled provider can still be tested.
      expect(await registry.testProvider('off')).toEqual({ ok: true, modelCount: 2 })
    })

    it('times out', async () => {
      listModels.mockImplementation(
        (_id: string, options?: ListOptions) =>
          new Promise((_resolve, reject) => {
            options!.signal!.addEventListener('abort', async () => {
              const { abortError } = await import('../../src/main/services/ai/providers/http')
              reject(abortError(options!.signal!))
            })
          })
      )
      expect(await registry.testProvider('cloud', { timeoutMs: 10 })).toEqual({
        ok: false,
        error: { code: 'ai.timeout' }
      })
    })
  })
})
