import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderSettings } from '../../src/main/services/settings'

const handlers = new Map<string, (input: unknown) => unknown>()

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../../src/main/ipc/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/ipc/registry')>()),
  handle: (channel: string, fn: (input: unknown) => unknown) => handlers.set(channel, fn)
}))

const { registerAiProviderHandlers } = await import('../../src/main/ipc/ai-provider-handlers')
type Deps = Parameters<typeof registerAiProviderHandlers>[0]

const cloud: ProviderSettings = {
  id: 'ollama-cloud',
  kind: 'ollama',
  label: 'Ollama Cloud',
  baseUrl: 'https://ollama.com',
  enabled: true
}

describe('registerAiProviderHandlers', () => {
  let providers: ProviderSettings[]
  let keys: Map<string, string>
  let deps: Deps
  let registry: {
    listModels: ReturnType<typeof vi.fn>
    listAllModels: ReturnType<typeof vi.fn>
    testProvider: ReturnType<typeof vi.fn>
    invalidate: ReturnType<typeof vi.fn>
  }

  const call = (channel: string, input?: unknown): Promise<unknown> =>
    Promise.resolve(handlers.get(channel)!(input))

  beforeEach(() => {
    handlers.clear()
    providers = [{ ...cloud }]
    keys = new Map()
    registry = {
      listModels: vi.fn(async () => [{ id: 'm' }]),
      listAllModels: vi.fn(async () => [{ id: 'all' }]),
      testProvider: vi.fn(async () => ({ ok: true, modelCount: 3 })),
      invalidate: vi.fn()
    }
    deps = {
      settings: {
        get: () => ({ ai: { providers } }),
        saveProvider: vi.fn(async (p: ProviderSettings) => {
          const i = providers.findIndex((x) => x.id === p.id)
          providers = i >= 0 ? providers.map((x, j) => (j === i ? p : x)) : [...providers, p]
        }),
        deleteProvider: vi.fn(async (id: string) => {
          providers = providers.filter((p) => p.id !== id)
        })
      },
      secrets: {
        has: vi.fn(async (id: string) => keys.has(id)),
        get: vi.fn(async (id: string) => keys.get(id)),
        set: vi.fn(async (id: string, key: string) => {
          if (key) keys.set(id, key)
          else keys.delete(id)
        }),
        delete: vi.fn(async (id: string) => {
          keys.delete(id)
        })
      },
      registry: registry as unknown as Deps['registry']
    }
    registerAiProviderHandlers(deps)
  })

  it('registers every provider channel', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        'ai.providers.list',
        'ai.providers.save',
        'ai.providers.delete',
        'ai.providers.setKey',
        'ai.providers.test',
        'ai.models.list'
      ].sort()
    )
  })

  it('list returns statuses with hasKey and never the key', async () => {
    keys.set('ollama-cloud', 'secret-key')
    const list = await call('ai.providers.list')
    expect(list).toEqual([{ ...cloud, hasKey: true, keyRequired: true }])
    expect(JSON.stringify(list)).not.toContain('secret-key')
  })

  it('save upserts by id and invalidates the registry', async () => {
    const custom = {
      id: 'self',
      kind: 'ollama',
      label: 'Self-hosted',
      baseUrl: 'http://localhost:11434',
      enabled: true
    }
    expect(await call('ai.providers.save', custom)).toEqual([
      { ...cloud, hasKey: false, keyRequired: true },
      { ...custom, hasKey: false, keyRequired: false }
    ])
    const renamed = await call('ai.providers.save', { ...cloud, label: 'Cloud' })
    expect((renamed as ProviderSettings[]).map((p) => [p.id, p.label])).toEqual([
      ['ollama-cloud', 'Cloud'],
      ['self', 'Self-hosted']
    ])
    expect(registry.invalidate).toHaveBeenCalledWith('self')
    expect(registry.invalidate).toHaveBeenCalledWith('ollama-cloud')
  })

  it('save refuses insecure base URLs and reserved headers', async () => {
    await expect(
      call('ai.providers.save', { ...cloud, id: 'x', baseUrl: 'http://example.com' })
    ).rejects.toMatchObject({ code: 'ai.insecureBaseUrl' })
    await expect(
      call('ai.providers.save', { ...cloud, id: 'x', extraHeaders: { Authorization: 'Bearer y' } })
    ).rejects.toMatchObject({ code: 'ai.invalidHeader', params: { name: 'Authorization' } })
    expect(deps.settings.saveProvider).not.toHaveBeenCalled()
  })

  it('delete removes the provider and its key', async () => {
    keys.set('ollama-cloud', 'k')
    expect(await call('ai.providers.delete', { providerId: 'ollama-cloud' })).toEqual([])
    expect(keys.has('ollama-cloud')).toBe(false)
    expect(deps.secrets.delete).toHaveBeenCalledWith('ollama-cloud')
    expect(registry.invalidate).toHaveBeenCalledWith('ollama-cloud')
    await expect(call('ai.providers.delete', { providerId: 'nope' })).rejects.toMatchObject({
      code: 'ai.providerNotFound'
    })
  })

  it('setKey stores (or clears) the key and returns the status', async () => {
    expect(await call('ai.providers.setKey', { providerId: 'ollama-cloud', key: 'abc' })).toEqual({
      ...cloud,
      hasKey: true,
      keyRequired: true
    })
    expect(registry.invalidate).toHaveBeenCalledWith('ollama-cloud')
    expect(await call('ai.providers.setKey', { providerId: 'ollama-cloud', key: '' })).toEqual({
      ...cloud,
      hasKey: false,
      keyRequired: true
    })
    await expect(
      call('ai.providers.setKey', { providerId: 'nope', key: 'abc' })
    ).rejects.toMatchObject({ code: 'ai.providerNotFound' })
  })

  it('test delegates to the registry', async () => {
    expect(await call('ai.providers.test', { providerId: 'ollama-cloud' })).toEqual({
      ok: true,
      modelCount: 3
    })
    expect(registry.testProvider).toHaveBeenCalledWith('ollama-cloud')
  })

  it('models.list: one provider or all of them', async () => {
    expect(await call('ai.models.list', { providerId: 'ollama-cloud', refresh: true })).toEqual([
      { id: 'm' }
    ])
    expect(registry.listModels).toHaveBeenCalledWith('ollama-cloud', { refresh: true })
    expect(await call('ai.models.list', undefined)).toEqual([{ id: 'all' }])
    expect(registry.listAllModels).toHaveBeenCalledWith({ refresh: undefined })
  })
})
