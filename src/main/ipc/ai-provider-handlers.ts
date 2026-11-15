import type { ProviderConfig, ProviderStatus } from '@shared/ai/types'
import { AppErrorException, handle } from './registry'
import type { SecretsStore } from '../services/secrets'
import type { ProviderSettings } from '../services/settings'
import {
  assertSafeBaseUrl,
  assertValidExtraHeaders,
  isLoopbackUrl,
  type ProviderRegistryService
} from '../services/ai/providers'

/** The settings methods these handlers need (SettingsService in the app). */
export interface ProviderSettingsStore {
  get(): { ai: { providers: ProviderSettings[] } }
  saveProvider(provider: ProviderSettings): Promise<unknown>
  deleteProvider(providerId: string): Promise<unknown>
}

export interface AiProviderHandlerDeps {
  settings: ProviderSettingsStore
  secrets: SecretsStore
  registry: Pick<
    ProviderRegistryService,
    'listModels' | 'listAllModels' | 'testProvider' | 'invalidate'
  >
}

/**
 * ai.providers.* and ai.models.list. Keys go in through setKey and never come back: the renderer only sees
 * `hasKey`. Deleting the last provider is allowed (the settings UI can add a preset again).
 */
export function registerAiProviderHandlers({
  settings,
  secrets,
  registry
}: AiProviderHandlerDeps): void {
  const providers = (): ProviderSettings[] => settings.get().ai.providers

  async function status(config: ProviderConfig): Promise<ProviderStatus> {
    return {
      ...config,
      hasKey: await secrets.has(config.id),
      keyRequired: !isLoopbackUrl(config.baseUrl)
    }
  }

  const statuses = (): Promise<ProviderStatus[]> => Promise.all(providers().map(status))

  function requireProvider(providerId: string): ProviderSettings {
    const config = providers().find((p) => p.id === providerId)
    if (!config) throw new AppErrorException('ai.providerNotFound', { providerId })
    return config
  }

  handle('ai.providers.list', () => statuses())

  handle('ai.providers.save', async (config) => {
    assertSafeBaseUrl(config.baseUrl)
    assertValidExtraHeaders(config.extraHeaders)
    await settings.saveProvider(config)
    registry.invalidate(config.id)
    return statuses()
  })

  handle('ai.providers.delete', async ({ providerId }) => {
    requireProvider(providerId)
    await secrets.delete(providerId)
    await settings.deleteProvider(providerId)
    registry.invalidate(providerId)
    return statuses()
  })

  handle('ai.providers.setKey', async ({ providerId, key }) => {
    const config = requireProvider(providerId)
    await secrets.set(providerId, key)
    registry.invalidate(providerId)
    return status(config)
  })

  handle('ai.providers.test', ({ providerId }) => registry.testProvider(providerId))

  handle('ai.models.list', (input) =>
    input?.providerId
      ? registry.listModels(input.providerId, { refresh: input.refresh })
      : registry.listAllModels({ refresh: input?.refresh })
  )
}
