/**
 * Interfaces between main-process services. Implementations:
 *   VanillaStore -> src/main/services/vanilla/ (launcher detection, Mojang download, jar extraction, index)
 *   PackService  -> src/main/services/packs/   (workspace, packs, textures, categories, import, export)
 * Tests use in-memory fakes of these interfaces.
 */
import type { McVersion, PackFormat } from '@shared/model/versions'
import type { MinecraftInstall, VanillaAvailability, VanillaIndex } from '@shared/model/vanilla'
import type { JobKind } from '@shared/model/jobs'

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
  versionForPackFormat(format: PackFormat): McVersion | undefined

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

  /** Absolute path of an extracted vanilla file (validated to stay in the cache), or null if absent. */
  resolveFile(versionId: string, packPath: string): string | null
}
