import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { packAssetUrl } from '@shared/assets'
import { getDefaultCategoryEngine, type CategoryEngine } from '@shared/categories'
import {
  CreatePackInputSchema,
  PACK_TYPE_FILE_SUFFIX,
  type CategorySummary,
  type CreatePackInput,
  type ExportPackType,
  type ExportProfile,
  type ExportReport,
  type ImportReport,
  type UpgradeReport,
  type PackSummary,
  type Project,
  type TextureEntry
} from '@shared/model/pack'
import { buildResourcePackMcmeta } from '@shared/versions/mcmeta'
import { canExportTo, isSnapshot } from '@shared/versions/support'
import { PathMigrator, canMigrate } from '@shared/versions/migrations'
import type { JobReporter, VanillaStore } from '../contracts'
import { AppErrorException } from '../../ipc/registry'
import { exportPackZip } from './exporter'
import { FileInfoCache, writeFileAtomic } from './files'
import { importPackZip, type ImportLimits } from './importer'
import { isRecord, mergeMcmeta, parseJson, toJsonBytes } from './mcmeta'
import { comparePaths, createUniqueFolder, scanFiles, slugify } from './paths'
import { resolvePackFile } from '../history/pack-files'
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
  exportTargetNotSupported: 'export.targetNotSupported',
  /** packs.upgrade to a version that is not newer, not supported or outside the migration chain. */
  upgradeNotSupported: 'packs.upgradeNotSupported'
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
  /**
   * What the creation agent can change: the pack's textures plus every vanilla texture of its authoring version,
   * whatever the base (for an empty pack, its own files plus vanilla). Throws packs.vanillaNotReady when the vanilla
   * textures are not extracted.
   */
  catalog(packId: string): Promise<TextureEntry[]>
  /**
   * Renames the pack and/or changes its description (project.json and the pack folder's pack.mcmeta description;
   * exports regenerate pack.mcmeta from the project anyway). The folder name does not change.
   */
  updateMeta(packId: string, patch: { name?: string; description?: string }): Promise<PackSummary>
  categories(packId: string): Promise<CategorySummary[]>
  importZip(zipPath: string): Promise<ImportReport>
  /**
   * Exports to several versions, one zip per target in `folder` (default file names, existing files replaced).
   * Stops at the first failure.
   */
  exportMany(
    packId: string,
    targetVersions: string[],
    folder: string,
    options?: { acceptNewer?: boolean; packType?: ExportPackType }
  ): Promise<ExportReport[]>
  /**
   * Moves the pack to a newer authoring version of the support window: renamed textures (and their .mcmeta) move to
   * their new names along the migration chain, pack.mcmeta gets the new format, project.json the new version.
   * Textures that no longer exist are left in place and listed.
   */
  upgrade(packId: string, toVersion: string): Promise<UpgradeReport>
  /** Remembers the last export settings in project.json (the dialog preselects them). */
  saveExportProfile(packId: string, profile: ExportProfile): Promise<void>
  /** Checks that `targetVersion` can be exported and returns the default file name "<slug>-<version>.zip". */
  exportFileName(packId: string, targetVersion: string, packType?: ExportPackType): Promise<string>
  exportPack(
    packId: string,
    targetVersion: string,
    outputPath: string,
    options?: { acceptNewer?: boolean; packType?: ExportPackType }
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
      updatedAt: project.updatedAt,
      ...(project.exportProfile ? { exportProfile: project.exportProfile } : {})
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

    async catalog(packId) {
      return indexer.textures(await requireLocation(packId), { catalog: true })
    },

    async updateMeta(packId, patch) {
      const location = await requireLocation(packId)
      const project: Project = {
        ...location.project,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        updatedAt: now().toISOString()
      }
      await writeProject(location.folder, project)
      if (patch.description !== undefined) {
        const file = join(location.folder, 'pack.mcmeta')
        const current = parseJson(await fs.readFile(file).catch(() => new Uint8Array()))
        const mcmeta = isRecord(current) ? current : {}
        const pack = isRecord(mcmeta['pack']) ? mcmeta['pack'] : {}
        await writeFileAtomic(
          file,
          toJsonBytes({ ...mcmeta, pack: { ...pack, description: patch.description } })
        )
      }
      deps.notifyChanged(packId)
      return summarize({ ...location, project })
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

    async exportFileName(packId, targetVersion, packType = 'resource') {
      const location = await requireLocation(packId)
      checkExportTarget(location, targetVersion)
      return `${slugify(location.project.name)}-${targetVersion}-${PACK_TYPE_FILE_SUFFIX[packType]}.zip`
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
    },

    async exportMany(packId, targetVersions, folder, options = {}) {
      const location = await requireLocation(packId)
      const unique = [...new Set(targetVersions)]
      // Validate every target before writing anything.
      const targets = unique.map((v) => checkExportTarget(location, v))
      const reports: ExportReport[] = []
      for (const target of targets) {
        const name = `${slugify(location.project.name)}-${target.id}-${PACK_TYPE_FILE_SUFFIX[options.packType ?? 'resource']}.zip`
        const onProgress = deps.jobs.start('pack.export')
        reports.push(
          await exportPackZip(
            location,
            target,
            join(folder, name),
            { vanilla: deps.vanilla, onProgress },
            options
          )
        )
      }
      return reports
    },

    async upgrade(packId, toVersion) {
      const location = await requireLocation(packId)
      const from = location.project.authoringVersion
      const current = deps.vanilla.getVersion(from)
      const target = deps.vanilla.getVersion(toVersion)
      const ok =
        current !== undefined &&
        target !== undefined &&
        !isSnapshot(target) &&
        Date.parse(target.releaseTime) > Date.parse(current.releaseTime) &&
        deps.vanilla.supportedVersions().some((v) => v.id === target.id) &&
        canMigrate(from, target.id)
      if (!ok || !target) {
        throw new AppErrorException(PackErrorCode.upgradeNotSupported, { from, to: toVersion })
      }
      const migrator = new PathMigrator(from, target.id)
      const files = await scanFiles(location.folder)
      const existing = new Set(files.map((f) => f.path))
      let renamed = 0
      const obsolete: string[] = []
      const conflicts: string[] = []
      const touched: string[] = []
      for (const file of files) {
        const r = migrator.migrateFile(file.path)
        if (!('path' in r)) {
          if (file.path.endsWith('.png')) obsolete.push(file.path)
          continue
        }
        if (!r.renamed) continue
        if (existing.has(r.path)) {
          conflicts.push(file.path)
          continue
        }
        const dest = resolvePackFile(location.folder, r.path)
        if (!dest) continue
        await fs.mkdir(dirname(dest), { recursive: true })
        await fs.rename(file.abs, dest)
        existing.add(r.path)
        touched.push(file.path, r.path)
        if (r.path.endsWith('.png')) renamed++
      }
      const mcmetaFile = join(location.folder, 'pack.mcmeta')
      const currentMcmeta = parseJson(await fs.readFile(mcmetaFile).catch(() => new Uint8Array()))
      await writeFileAtomic(
        mcmetaFile,
        toJsonBytes(
          mergeMcmeta(buildResourcePackMcmeta(location.project.description, target), currentMcmeta)
        )
      )
      const project: Project = {
        ...location.project,
        authoringVersion: target.id,
        updatedAt: now().toISOString()
      }
      await writeProject(location.folder, project)
      for (const path of touched) fileInfo.delete(join(location.folder, ...path.split('/')))
      indexer.forget(packId)
      deps.notifyChanged(packId)
      return {
        pack: await summarize({ ...location, project }),
        from,
        to: target.id,
        renamed,
        obsolete,
        conflicts
      }
    },

    async saveExportProfile(packId, profile) {
      const location = await requireLocation(packId)
      await writeProject(location.folder, { ...location.project, exportProfile: profile })
      // The open tab reloads its summary, so the dialog preselects these settings next time.
      deps.notifyChanged(packId)
    }
  }

  /**
   * The authoring version, a snapshot newer than it, or a release of the support window reachable through the
   * migration chain (see canExportTo and migrations.ts).
   */
  function checkExportTarget(
    location: PackLocation,
    targetVersion: string
  ): NonNullable<ReturnType<VanillaStore['getVersion']>> {
    const authoring = location.project.authoringVersion
    const authoringVersion = deps.vanilla.getVersion(authoring)
    const candidate = deps.vanilla.getVersion(targetVersion)
    const otherRelease =
      candidate !== undefined && candidate.id !== authoring && !isSnapshot(candidate)
    const reachable =
      !otherRelease ||
      (canMigrate(authoring, candidate.id) &&
        deps.vanilla.supportedVersions().some((v) => v.id === candidate.id))
    const target =
      authoringVersion && candidate && canExportTo(authoringVersion, candidate) && reachable
        ? candidate
        : undefined
    if (!target) {
      throw new AppErrorException(PackErrorCode.exportTargetNotSupported, {
        target: targetVersion,
        authoring
      })
    }
    return target
  }
}
