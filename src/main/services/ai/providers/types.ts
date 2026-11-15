import type { ModelInfo, ProviderAdapter, ProviderConfig, ProviderKind } from '@shared/ai/types'
import type { FetchLike, ProviderLogger, SleepFn } from './http'

export interface ListModelsOptions {
  signal?: AbortSignal
  /** false: names only, capabilities from hints (fast; used by "Test connection"). Default true. */
  details?: boolean
}

/** Adapter as built by this module (the shared ProviderAdapter plus list options). */
export interface ProviderAdapterImpl extends ProviderAdapter {
  listModels(options?: ListModelsOptions): Promise<ModelInfo[]>
}

export interface AdapterDeps {
  config: ProviderConfig
  /** Undefined only for loopback providers (self-hosted Ollama needs no key). */
  apiKey?: string
  fetch: FetchLike
  logger?: ProviderLogger
  sleep?: SleepFn
  retryBaseDelayMs?: number
}

export type AdapterFactory = (deps: AdapterDeps) => ProviderAdapterImpl

/** One factory per provider kind; M4 registers 'openai-compatible' here. */
export type AdapterFactories = Partial<Record<ProviderKind, AdapterFactory>>
