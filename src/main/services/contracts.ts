/**
 * Interfaces between main-process services. Implementations:
 *   VanillaStore -> src/main/services/vanilla/ (launcher detection, Mojang download, jar extraction, index)
 *   PackService  -> src/main/services/packs/   (workspace, packs, textures, categories, import, export)
 * Tests use in-memory fakes of these interfaces.
 */
import type { McVersion, PackFormat } from '@shared/model/versions'
import type { MinecraftInstall, VanillaAvailability, VanillaIndex } from '@shared/model/vanilla'
import type { JobKind } from '@shared/model/jobs'
import type { JarEntityModels } from './entity-models/extract'

/** Progress callback for long operations; main forwards it to the renderer as 'job.progress'. */
export type ProgressFn = (phase: string, done: number, total: number) => void

export interface JobReporter {
  start(kind: JobKind): ProgressFn
}

export interface VanillaStore {
  /** Releases inside the support window (last 24 months + latest), newest first. */
  supportedVersions(): McVersion[]
  latestVersion(): McVersion
  getVersion(versionId: string): McVersion | undefined
  /** Version whose resource pack format matches (exact major; nearest lower release if several). */
  /** `type` 'data' matches the data pack format instead (data pack imports). */
  versionForPackFormat(format: PackFormat, type?: 'resource' | 'data'): McVersion | undefined

  detectInstalls(): Promise<MinecraftInstall[]>
  availability(): Promise<VanillaAvailability[]>

  /**
   * Makes the vanilla assets of `versionId` available in the cache: uses the cache if present, else a local
   * jar, else downloads from Mojang when `allowDownload` is true (throws AppErrorException otherwise).
   */
  prepare(
    versionId: string,
    options: { allowDownload: boolean; onProgress?: ProgressFn }
  ): Promise<VanillaIndex>

  /** Index of an already-extracted version, or null if not extracted yet. */
  getIndex(versionId: string): Promise<VanillaIndex | null>

  /**
   * Makes sure the extracted version also has its vanilla data (recipes, loot tables, tags, advancements; PLAN M10):
   * versions extracted before data support get it from their jar. False when the version is not extracted or its
   * jar is gone (only the pack's own data files can be listed then).
   */
  prepareData(versionId: string): Promise<boolean>

  /** Absolute path of an extracted vanilla file (validated to stay in the cache), or null if absent. */
  resolveFile(versionId: string, packPath: string): string | null

  /**
   * Entity model geometry read from the version's client jar (26.1+; PLAN M3b), cached next to the extracted
   * assets. Built on first use for versions extracted earlier. Null when the version is not extracted, its jar is
   * gone, or the jar's code is obfuscated (older versions).
   */
  entityModels(versionId: string): Promise<JarEntityModels | null>
}

// ---------- AI (M3) ----------
import type { ModelInfo, ModelRef, ProviderAdapter } from '@shared/ai/types'

/**
 * Provider registry (src/main/services/ai/providers/). The agent runtime asks it for an adapter and model info;
 * keys are resolved internally from the encrypted secrets store and never exposed.
 */
export interface ProviderRegistry {
  /** Throws AppErrorException('ai.providerNotFound' | 'ai.noApiKey' | 'ai.providerDisabled'). */
  getAdapter(providerId: string): Promise<ProviderAdapter>
  /** Model info from the (cached) model list, if known. */
  getModel(ref: ModelRef): Promise<ModelInfo | undefined>
}
