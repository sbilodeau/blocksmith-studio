import { promises as fs } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { packAssetUrl } from '@shared/assets'
import { getDefaultCategoryEngine, type CategoryEngine } from '@shared/categories'
import {
  CreatePackInputSchema,
  type CategorySummary,
  type CreatePackInput,
  type ExportReport,
  type ImportReport,
  type PackSummary,
  type Project,
  type TextureEntry
} from '@shared/model/pack'
import { buildResourcePackMcmeta } from '@shared/versions/mcmeta'
import type { JobReporter, VanillaStore } from '../contracts'
import { AppErrorException } from '../../ipc/registry'
import { exportPackZip } from './exporter'
import { FileInfoCache, writeFileAtomic } from './files'
import { importPackZip, type ImportLimits } from './importer'
import { toJsonBytes } from './mcmeta'
import { comparePaths, createUniqueFolder, slugify } from './paths'
import { createDefaultPackIcon } from './png'
import { newPackId, readProject, writeProject, type PackLocation } from './project'
import { TEXTURE_PNG, TextureIndexer, scanPackTextures, summarizeCategories } from './textures'

/** Folder created under the user's Documents when no workspace was chosen. */
export const DEFAULT_WORKSPACE_NAME = 'Blocksmith Studio'
/** Vanilla texture upscaled for the default pack.png of vanilla-based packs. */
export const DEFAULT_ICON_TEXTURE = 'assets/minecraft/textures/block/grass_block_side.png'

/** Error codes thrown by the pack service (i18n: `errors.<code>`). Import/export codes live in their modules. */
export const PackErrorCode = {
  notFound: 'packs.notFound',
  unsupportedVersion: 'packs.unsupportedVersion',
  vanillaNotReady: 'packs.vanillaNotReady',
  invalidWorkspace: 'workspace.invalidPath',
  exportTargetNotSupported: 'export.targetNotSupported'
} as const

export interface PackServiceDeps {
  vanilla: VanillaStore
  jobs: JobReporter
  /** Electron app.getPath('documents'). */
  documentsDir: string
  /** Current settings.workspacePath (undefined = default workspace). */
  getWorkspacePath: () => string | undefined
  /** Persists settings.workspacePath (SettingsService). */
  setWorkspacePath: (path: string) => Promise<void> | void
  /** shell.trashItem */
  trashItem: (path: string) => Promise<void>
  /** shell.showItemInFolder */
  showItemInFolder: (path: string) => void
  /** Main forwards this as the 'packs.changed' event. */
  notifyChanged: (packId?: string) => void
  /** Overridable for tests. */
  now?: () => Date
  newId?: () => string
  categories?: CategoryEngine
  importLimits?: ImportLimits
}

export interface PackService {
  /** Workspace root (settings.workspacePath or <Documents>/Blocksmith Studio). */
  workspaceRoot(): string
  /** <root>/packs */
  packsDir(): string
  /** Validates, creates <path>/packs, persists the choice and returns the new root. */
  setWorkspace(path: string): Promise<string>
  list(): Promise<PackSummary[]>
  create(input: CreatePackInput): Promise<PackSummary>
  get(packId: string): Promise<PackSummary>
  /** Folder and project of a pack, or null when unknown (used by the bs-asset protocol). */
  locate(packId: string): Promise<PackLocation | null>
  delete(packId: string): Promise<void>
  reveal(packId: string): Promise<void>
  textures(packId: string): Promise<TextureEntry[]>
  categories(packId: string): Promise<CategorySummary[]>
  importZip(zipPath: string): Promise<ImportReport>
  /** Checks that `targetVersion` can be exported and returns the default file name "<slug>-<version>.zip". */
  exportFileName(packId: string, targetVersion: string): Promise<string>
  exportPack(
    packId: string,
    targetVersion: string,
    outputPath: string,
    options?: { acceptNewer?: boolean }
  ): Promise<ExportReport>
}

/**
 * Cache control for in-process writers (texture editing, history undo/redo). The texture index is invalidated
 * by size + mtime, which can miss a rewrite with the same size inside the file system's mtime granularity, so
 * writers call this after changing pack files.
 */
export interface PackCacheControl {
  /** Drops the cached hashes of `paths` (pack-relative POSIX) and the cached texture list of the pack. */
  invalidate(location: PackLocation, paths: readonly string[]): void
}

export function createPackService(deps: PackServiceDeps): PackService & PackCacheControl {
  const now = deps.now ?? ((): Date => new Date())
  const newId = deps.newId ?? newPackId
  const engine = deps.categories ?? getDefaultCategoryEngine()
  const fileInfo = new FileInfoCache()
  const indexer = new TextureIndexer(deps.vanilla, engine, fileInfo)
  /** packId -> absolute folder, refreshed by every scan. */
  const folders = new Map<string, string>()

  function workspaceRoot(): string {
    const configured = deps.getWorkspacePath()
    return configured && isAbsolute(configured)
      ? resolve(configured)
      : join(deps.documentsDir, DEFAULT_WORKSPACE_NAME)
  }

  function packsDir(): string {
    return join(workspaceRoot(), 'packs')
  }

  /** Scans <root>/packs/<folder>/.blocksmith/project.json. Invalid or duplicate packs are skipped. */
  async function scan(): Promise<PackLocation[]> {
    const dir = packsDir()
    let names: string[]
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      names = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort(comparePaths)
    } catch {
      names = []
    }
    const projects = await Promise.all(names.map((n) => readProject(join(dir, n))))
    const found: PackLocation[] = []
    folders.clear()
    projects.forEach((project, i) => {
      if (!project || folders.has(project.id)) return
      const folder = join(dir, names[i])
      folders.set(project.id, folder)
      found.push({ id: project.id, folder, project })
    })
    return found
  }

  async function locate(packId: string): Promise<PackLocation | null> {
    const known = folders.get(packId)
    if (known) {
      const project = await readProject(known)
      if (project?.id === packId) return { id: packId, folder: known, project }
    }
    const found = (await scan()).find((p) => p.id === packId)
    return found ?? null
  }

  async function requireLocation(packId: string): Promise<PackLocation> {
    const location = await locate(packId)
    if (!location) throw new AppErrorException(PackErrorCode.notFound, { packId })
    return location
  }

  async function changedCount(location: PackLocation): Promise<number> {
    try {
      const entries = await indexer.textures(location)
      return entries.filter((e) => e.status !== 'vanilla').length
    } catch (err) {
      if (!(err instanceof AppErrorException)) throw err
      // Vanilla not extracted yet: every texture file of the pack counts as a change.
      const files = await scanPackTextures(location.folder)
      return files.filter((f) => TEXTURE_PNG.test(f.path)).length
    }
  }

  async function summarize(location: PackLocation): Promise<PackSummary> {
    const { project, folder } = location
    const summary: PackSummary = {
      id: project.id,
      name: project.name,
      description: project.description,
      authoringVersion: project.authoringVersion,
      base: project.base,
      folder,
      changedCount: await changedCount(location),
      updatedAt: project.updatedAt
    }
    try {
      const st = await fs.stat(join(folder, 'pack.png'))
      if (st.isFile()) {
        summary.iconUrl = packAssetUrl(project.id, 'pack.png', String(Math.round(st.mtimeMs)))
      }
    } catch {
      // no icon
    }
    return summary
  }

  async function defaultIcon(project: Project): Promise<Uint8Array> {
    let texture: Uint8Array | undefined
    if (project.base === 'vanilla') {
      const file = deps.vanilla.resolveFile(project.authoringVersion, DEFAULT_ICON_TEXTURE)
      if (file) texture = await fs.readFile(file).catch(() => undefined)
    }
    return createDefaultPackIcon({ seed: `${project.id}:${project.name}`, texture })
  }

  function supportedVersion(versionId: string): ReturnType<VanillaStore['getVersion']> {
    const version = deps.vanilla.getVersion(versionId)
    if (!version || !deps.vanilla.supportedVersions().some((v) => v.id === versionId)) {
      return undefined
    }
    return version
  }

  return {
    workspaceRoot,
    packsDir,

    async setWorkspace(path) {
      if (!path || !isAbsolute(path)) {
        throw new AppErrorException(PackErrorCode.invalidWorkspace)
      }
      const root = resolve(path)
      try {
        await fs.mkdir(join(root, 'packs'), { recursive: true })
      } catch {
        throw new AppErrorException(PackErrorCode.invalidWorkspace)
      }
      await deps.setWorkspacePath(root)
      folders.clear()
      indexer.forget()
      fileInfo.clear()
      deps.notifyChanged()
      return root
    },

    async list() {
      const locations = await scan()
      const summaries = await Promise.all(locations.map(summarize))
      return summaries.sort(
        (a, b) => comparePaths(b.updatedAt, a.updatedAt) || comparePaths(a.name, b.name)
      )
    },

    async create(rawInput) {
      const input = CreatePackInputSchema.parse(rawInput)
      const version = supportedVersion(input.authoringVersion)
      if (!version) {
        throw new AppErrorException(PackErrorCode.unsupportedVersion, {
          version: input.authoringVersion
        })
      }
      if (input.base === 'vanilla' && !(await deps.vanilla.getIndex(version.id))) {
        throw new AppErrorException(PackErrorCode.vanillaNotReady, { version: version.id })
      }
      const timestamp = now().toISOString()
      const project: Project = {
        schemaVersion: 1,
        id: newId(),
        name: input.name,
        description: input.description,
        authoringVersion: version.id,
        base: input.base,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      const dir = packsDir()
      const folder = join(dir, await createUniqueFolder(dir, slugify(input.name)))
      try {
        await writeFileAtomic(
          join(folder, 'pack.mcmeta'),
          toJsonBytes(buildResourcePackMcmeta(project.description, version))
        )
        await writeFileAtomic(join(folder, 'pack.png'), await defaultIcon(project))
        await writeProject(folder, project)
      } catch (err) {
        await fs.rm(folder, { recursive: true, force: true })
        throw err
      }
      folders.set(project.id, folder)
      deps.notifyChanged(project.id)
      return summarize({ id: project.id, folder, project })
    },

    async get(packId) {
      return summarize(await requireLocation(packId))
    },

    locate,

    invalidate(location, paths) {
      for (const path of paths) fileInfo.delete(join(location.folder, ...path.split('/')))
      indexer.forget(location.id)
    },

    async delete(packId) {
      const location = await requireLocation(packId)
      await deps.trashItem(location.folder)
      folders.delete(packId)
      indexer.forget(packId)
      fileInfo.forget(location.folder)
      deps.notifyChanged(packId)
    },

    async reveal(packId) {
      const location = await requireLocation(packId)
      deps.showItemInFolder(location.folder)
    },

    async textures(packId) {
      return indexer.textures(await requireLocation(packId))
    },

    async categories(packId) {
      const entries = await indexer.textures(await requireLocation(packId))
      return summarizeCategories(entries, engine)
    },

    async importZip(zipPath) {
      const onProgress = deps.jobs.start('packs.import')
      const dir = packsDir()
      await fs.mkdir(dir, { recursive: true })
      const { location, report } = await importPackZip(zipPath, {
        vanilla: deps.vanilla,
        packsDir: dir,
        packId: newId(),
        now: now(),
        onProgress,
        limits: deps.importLimits
      })
      folders.set(location.id, location.folder)
      deps.notifyChanged(location.id)
      return { ...report, pack: await summarize(location) }
    },

    async exportFileName(packId, targetVersion) {
      const location = await requireLocation(packId)
      checkExportTarget(location, targetVersion)
      return `${slugify(location.project.name)}-${targetVersion}.zip`
    },

    async exportPack(packId, targetVersion, outputPath, options = {}) {
      const location = await requireLocation(packId)
      const target = checkExportTarget(location, targetVersion)
      const onProgress = deps.jobs.start('pack.export')
      return exportPackZip(
        location,
        target,
        outputPath,
        { vanilla: deps.vanilla, onProgress },
        options
      )
    }
  }

  /** M1: only the authoring version can be exported (multi-version export comes with migrations in M7). */
  function checkExportTarget(
    location: PackLocation,
    targetVersion: string
  ): NonNullable<ReturnType<VanillaStore['getVersion']>> {
    const authoring = location.project.authoringVersion
    const target = targetVersion === authoring ? deps.vanilla.getVersion(targetVersion) : undefined
    if (!target) {
      throw new AppErrorException(PackErrorCode.exportTargetNotSupported, {
        target: targetVersion,
        authoring
      })
    }
    return target
  }
}
