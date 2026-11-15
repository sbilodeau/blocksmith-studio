import type { ModelInfo, ModelRef, ProviderConfig } from '@shared/ai/types'
import type { ProviderRegistry } from '../../contracts'
import type { SecretsStore } from '../../secrets'
import { AppErrorException, toAppError } from '../../../ipc/registry'
import { assertSafeBaseUrl, isLoopbackUrl, type FetchLike, type ProviderLogger } from './http'
import type { SleepFn } from './http'
import { createOllamaAdapter } from './ollama'
import type { AdapterFactories, ProviderAdapterImpl } from './types'

/** Model lists are cached per provider for 10 minutes (`refresh: true` bypasses the cache). */
export const MODEL_CACHE_TTL_MS = 10 * 60 * 1000
/** "Test connection" gives up after this delay. */
export const TEST_TIMEOUT_MS = 15_000

export const DEFAULT_ADAPTER_FACTORIES: AdapterFactories = {
  ollama: createOllamaAdapter
  // 'openai-compatible': M4
}

export interface ProviderTestResult {
  ok: boolean
  modelCount?: number
  error?: { code: string; params?: Record<string, string | number> }
}

/** Main-only registry API (the agent runtime only needs the ProviderRegistry part). */
export interface ProviderRegistryService extends ProviderRegistry {
  /** Models of one provider (cached 10 min). Throws like getAdapter, plus HTTP errors. */
  listModels(providerId: string, options?: { refresh?: boolean }): Promise<ModelInfo[]>
  /** Models of every enabled, usable provider; failing providers are skipped and logged. */
  listAllModels(options?: { refresh?: boolean }): Promise<ModelInfo[]>
  /** Lists models with a short timeout; never throws, returns the error code instead. */
  testProvider(providerId: string, options?: { timeoutMs?: number }): Promise<ProviderTestResult>
  /** Whether getAdapter can work without throwing 'ai.noApiKey' (key stored, or loopback provider). */
  isUsable(config: ProviderConfig): Promise<boolean>
  /** Drops cached adapters and models (after a config or key change). No id = everything. */
  invalidate(providerId?: string): void
}

export interface ProviderRegistryDeps {
  getProviders(): readonly ProviderConfig[]
  secrets: Pick<SecretsStore, 'get' | 'has'>
  /** Electron `net.fetch` in the app. */
  fetch: FetchLike
  logger?: ProviderLogger
  now?: () => number
  factories?: AdapterFactories
  modelCacheTtlMs?: number
  /** Test hooks for retry backoff. */
  sleep?: SleepFn
  retryBaseDelayMs?: number
}

export function createProviderRegistry(deps: ProviderRegistryDeps): ProviderRegistryService {
  const {
    secrets,
    logger = console,
    now = Date.now,
    factories = DEFAULT_ADAPTER_FACTORIES,
    modelCacheTtlMs = MODEL_CACHE_TTL_MS
  } = deps

  const adapters = new Map<string, { fingerprint: string; adapter: ProviderAdapterImpl }>()
  const models = new Map<string, { at: number; fingerprint: string; models: ModelInfo[] }>()
  const inflight = new Map<string, Promise<ModelInfo[]>>()

  const fingerprintOf = (config: ProviderConfig): string => JSON.stringify(config)

  function findConfig(providerId: string): ProviderConfig {
    const config = deps.getProviders().find((p) => p.id === providerId)
    if (!config) throw new AppErrorException('ai.providerNotFound', { providerId })
    return config
  }

  async function buildAdapter(config: ProviderConfig): Promise<ProviderAdapterImpl> {
    assertSafeBaseUrl(config.baseUrl)
    const apiKey = await secrets.get(config.id)
    if (!apiKey && !isLoopbackUrl(config.baseUrl)) {
      throw new AppErrorException('ai.noApiKey', { providerId: config.id })
    }
    const factory = factories[config.kind]
    if (!factory) throw new AppErrorException('ai.providerKindUnsupported', { kind: config.kind })
    return factory({
      config,
      apiKey,
      fetch: deps.fetch,
      logger,
      sleep: deps.sleep,
      retryBaseDelayMs: deps.retryBaseDelayMs
    })
  }

  async function adapterFor(config: ProviderConfig): Promise<ProviderAdapterImpl> {
    if (!config.enabled)
      throw new AppErrorException('ai.providerDisabled', { providerId: config.id })
    const fingerprint = fingerprintOf(config)
    const cached = adapters.get(config.id)
    if (cached && cached.fingerprint === fingerprint) return cached.adapter
    const adapter = await buildAdapter(config)
    adapters.set(config.id, { fingerprint, adapter })
    return adapter
  }

  async function listModels(
    providerId: string,
    options: { refresh?: boolean } = {}
  ): Promise<ModelInfo[]> {
    const config = findConfig(providerId)
    const fingerprint = fingerprintOf(config)
    const cached = models.get(providerId)
    if (
      !options.refresh &&
      cached &&
      cached.fingerprint === fingerprint &&
      now() - cached.at < modelCacheTtlMs
    ) {
      return cached.models
    }
    const running = inflight.get(providerId)
    if (running && !options.refresh) return running
    const task = (async (): Promise<ModelInfo[]> => {
      const adapter = await adapterFor(config)
      const list = await adapter.listModels()
      models.set(providerId, { at: now(), fingerprint, models: list })
      return list
    })()
    inflight.set(providerId, task)
    try {
      return await task
    } finally {
      if (inflight.get(providerId) === task) inflight.delete(providerId)
    }
  }

  async function isUsable(config: ProviderConfig): Promise<boolean> {
    return isLoopbackUrl(config.baseUrl) || (await secrets.has(config.id))
  }

  return {
    async getAdapter(providerId) {
      return adapterFor(findConfig(providerId))
    },

    async getModel(ref: ModelRef) {
      try {
        const list = await listModels(ref.providerId)
        return list.find((m) => m.id === ref.modelId)
      } catch (err) {
        logger.warn(`[ai] model info unavailable for ${ref.providerId}/${ref.modelId}`, {
          code: toAppError(err).code
        })
        return undefined
      }
    },

    listModels,

    async listAllModels(options = {}) {
      const all: ModelInfo[] = []
      for (const config of deps.getProviders()) {
        if (!config.enabled || !(await isUsable(config))) continue
        try {
          all.push(...(await listModels(config.id, options)))
        } catch (err) {
          logger.warn(`[ai] skipping provider ${config.id}`, { code: toAppError(err).code })
        }
      }
      return all
    },

    async testProvider(providerId, options = {}) {
      try {
        const config = findConfig(providerId)
        // Built fresh (also for a disabled provider) so the test reflects the current config and key.
        const adapter = await buildAdapter(config)
        const list = await adapter.listModels({
          signal: AbortSignal.timeout(options.timeoutMs ?? TEST_TIMEOUT_MS),
          details: false
        })
        return { ok: true, modelCount: list.length }
      } catch (err) {
        const error = toAppError(err)
        return { ok: false, error: error.params ? error : { code: error.code } }
      }
    },

    isUsable,

    invalidate(providerId) {
      if (providerId === undefined) {
        adapters.clear()
        models.clear()
        inflight.clear()
        return
      }
      adapters.delete(providerId)
      models.delete(providerId)
      inflight.delete(providerId)
    }
  }
}
