/**
 * VanillaStore implementation: version table queries, launcher detection, Mojang download and the extracted
 * vanilla cache in userData/vanilla/<versionId>/ (ready when its index.json exists).
 */
import { existsSync, statSync } from 'node:fs'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { McVersion, VersionTable } from '@shared/model/versions'
import type { MinecraftInstall, VanillaAvailability, VanillaIndex } from '@shared/model/vanilla'
import {
  findVersion,
  latest,
  supportedVersions,
  versionForPackFormat,
  versionTable as bundledTable
} from '@shared/versions'
import { AppErrorException } from '../../ipc/registry'
import type { ProgressFn, VanillaStore } from '../contracts'
import {
  detectInstalls,
  nodeDetectFs,
  scanManualPath,
  type DetectEnv,
  type DetectFs
} from './detect'
import { VanillaError, VanillaErrorCode } from './errors'
import { INDEX_FILE, indexEntry, readJarData, writeEntries, type ExtractRunner } from './extract'
import {
  ENTITY_MODELS_FILE,
  ENTITY_MODELS_SCHEMA_VERSION,
  extractEntityModelsFromJar,
  parseEntityModels,
  type JarEntityModels
} from '../entity-models/extract'
import type { MojangClient } from './mojang'
import { isSafeVersionId, resolveInside } from './paths'

export interface VanillaStoreDeps {
  /** Electron's userData folder: jars go to <userData>/jars, extracted assets to <userData>/vanilla. */
  userDataDir: string
  /** Defaults to the bundled resources/data/versions.json. */
  table?: VersionTable
  now?: () => Date
  detectEnv: DetectEnv
  detectFs?: DetectFs
  /** Folders / jars added by hand (settings.minecraftPaths), read on every detection. */
  getMinecraftPaths: () => readonly string[]
  mojang: MojangClient
  /** Extraction runner: a worker thread in the app, extractVanillaJar directly in tests. */
  extract: ExtractRunner
  /**
   * Reads entity models from a jar for versions extracted before M3b (defaults to running the interpreter
   * inline; it takes a fraction of a second).
   */
  extractModels?: (jarPath: string, versionId: string) => Promise<JarEntityModels | null>
  logger?: Pick<Console, 'warn'>
}

/** The store plus helpers used by the IPC handlers (not part of the shared VanillaStore contract). */
export interface VanillaStoreImpl extends VanillaStore {
  /** Scans a folder or jar picked by hand; null if it holds no supported release. */
  inspectPath(path: string): Promise<MinecraftInstall | null>
}

/** Converts any failure to an AppErrorException that can cross IPC. */
export function toAppErrorException(err: unknown): AppErrorException {
  if (err instanceof AppErrorException) return err
  if (err instanceof VanillaError) return new AppErrorException(err.code, err.params)
  return new AppErrorException(VanillaErrorCode.extractFailed, {
    reason: err instanceof Error ? err.message : String(err)
  })
}

function isIndex(value: unknown, versionId: string): value is VanillaIndex {
  const index = value as Partial<VanillaIndex> | null
  return (
    !!index &&
    index.schemaVersion === 1 &&
    index.versionId === versionId &&
    typeof index.entries === 'object' &&
    index.entries !== null
  )
}

export function createVanillaStore(deps: VanillaStoreDeps): VanillaStoreImpl {
  const table = deps.table ?? bundledTable
  const now = deps.now ?? ((): Date => new Date())
  const fs = deps.detectFs ?? nodeDetectFs
  const logger = deps.logger ?? console
  const vanillaRoot = join(deps.userDataDir, 'vanilla')
  const jarsDir = join(deps.userDataDir, 'jars')
  const indexCache = new Map<string, VanillaIndex>()
  const modelsCache = new Map<string, Promise<JarEntityModels | null>>()
  const dataInflight = new Map<string, Promise<boolean>>()
  const inflight = new Map<string, { promise: Promise<VanillaIndex>; listeners: Set<ProgressFn> }>()

  const versionDir = (id: string): string => join(vanillaRoot, id)
  const downloadedJar = (id: string): string => join(jarsDir, `${id}.jar`)

  function knownVersion(versionId: string): McVersion | undefined {
    return isSafeVersionId(versionId) ? findVersion(table, versionId) : undefined
  }

  async function indexExists(id: string): Promise<boolean> {
    try {
      return (await stat(join(versionDir(id), INDEX_FILE))).isFile()
    } catch {
      return false
    }
  }

  function detect(): Promise<MinecraftInstall[]> {
    return detectInstalls({
      env: deps.detectEnv,
      fs,
      versionIds: table.versions.map((v) => v.id),
      manualPaths: deps.getMinecraftPaths()
    })
  }

  /**
   * A client jar for `id` on disk: folders / jars added by hand first (the user chose them), then auto-detected
   * launcher installs, then a jar downloaded earlier.
   */
  async function localJar(id: string, installs: MinecraftInstall[]): Promise<string | undefined> {
    const ordered = [
      ...installs.filter((i) => i.launcher === 'custom'),
      ...installs.filter((i) => i.launcher !== 'custom')
    ]
    for (const install of ordered) {
      const match = install.versions.find((v) => v.id === id)
      if (match) return match.jarPath
    }
    return (await fs.isFile(downloadedJar(id))) ? downloadedJar(id) : undefined
  }

  async function getIndex(versionId: string): Promise<VanillaIndex | null> {
    if (!knownVersion(versionId)) return null
    const cached = indexCache.get(versionId)
    if (cached) return cached
    try {
      const parsed: unknown = JSON.parse(
        await readFile(join(versionDir(versionId), INDEX_FILE), 'utf8')
      )
      if (!isIndex(parsed, versionId)) return null
      indexCache.set(versionId, parsed)
      return parsed
    } catch {
      return null
    }
  }

  async function runPrepare(
    version: McVersion,
    allowDownload: boolean,
    progress: ProgressFn
  ): Promise<VanillaIndex> {
    const existing = await getIndex(version.id)
    if (existing) return existing

    let jarPath = await localJar(version.id, await detect())
    if (!jarPath) {
      if (!allowDownload) {
        throw new AppErrorException(VanillaErrorCode.downloadNotAllowed, { version: version.id })
      }
      jarPath = downloadedJar(version.id)
      await deps.mojang.downloadClientJar(version.id, jarPath, progress)
    }

    indexCache.delete(version.id)
    modelsCache.delete(version.id)
    const index = await deps.extract(
      { jarPath, outDir: versionDir(version.id), versionId: version.id },
      progress
    )
    const { resourcePack: jar } = index
    if (jar.major !== version.resourcePack.major || jar.minor !== version.resourcePack.minor) {
      logger.warn(
        `[vanilla] ${version.id}: jar resource pack format ${jar.major}.${jar.minor} differs from ` +
          `versions.json ${version.resourcePack.major}.${version.resourcePack.minor}`
      )
    }
    indexCache.set(version.id, index)
    return index
  }

  const extractModels =
    deps.extractModels ??
    (async (jarPath: string, versionId: string): Promise<JarEntityModels | null> =>
      extractEntityModelsFromJar(new Uint8Array(await readFile(jarPath)), { versionId, now }))

  /** Cached file, else built once from the jar (versions extracted before M3b). */
  async function loadEntityModels(versionId: string): Promise<JarEntityModels | null> {
    const file = join(versionDir(versionId), ENTITY_MODELS_FILE)
    try {
      const cached = parseEntityModels(await readFile(file, 'utf8'))
      if (cached) return cached
    } catch {
      // not written yet
    }
    if (!(await indexExists(versionId))) return null
    const jarPath = await localJar(versionId, await detect())
    if (!jarPath) return null
    let models: JarEntityModels | null
    try {
      models = await extractModels(jarPath, versionId)
    } catch (err) {
      logger.warn(`[vanilla] ${versionId}: entity models not read: ${String(err)}`)
      return null
    }
    // Obfuscated (pre-26.1) jars: remember that there is nothing to read.
    const out: JarEntityModels = models ?? {
      schemaVersion: ENTITY_MODELS_SCHEMA_VERSION,
      versionId,
      generatedAt: now().toISOString(),
      layers: {},
      skipped: [],
      stats: { steps: 0, aborts: 0 }
    }
    try {
      await writeFile(`${file}.tmp`, JSON.stringify(out))
      await rename(`${file}.tmp`, file)
    } catch (err) {
      logger.warn(`[vanilla] ${versionId}: could not cache entity models: ${String(err)}`)
    }
    return out
  }

  /**
   * Adds the vanilla data of a version extracted before data support: reads data/minecraft/... from its jar, writes
   * the files next to the assets and rewrites index.json with their entries and `data: true` (tmp + rename).
   */
  async function addData(versionId: string): Promise<boolean> {
    const index = await getIndex(versionId)
    if (!index) return false
    if (index.data) return true
    const jarPath = await localJar(versionId, await detect())
    if (!jarPath) return false
    try {
      const files = readJarData(new Uint8Array(await readFile(jarPath)))
      const paths = Object.keys(files).sort()
      await writeEntries(versionDir(versionId), files, paths)
      const entries = { ...index.entries }
      for (const path of paths) entries[path] = indexEntry(path, files[path], files)
      const updated: VanillaIndex = { ...index, data: true, entries }
      const file = join(versionDir(versionId), INDEX_FILE)
      await writeFile(`${file}.tmp`, JSON.stringify(updated))
      await rename(`${file}.tmp`, file)
      indexCache.set(versionId, updated)
      return true
    } catch (err) {
      logger.warn(`[vanilla] ${versionId}: vanilla data not added: ${String(err)}`)
      return false
    }
  }

  return {
    supportedVersions: () => supportedVersions(table, now()),
    latestVersion: () => latest(table),
    getVersion: (versionId) => findVersion(table, versionId),
    versionForPackFormat: (format, type) => versionForPackFormat(table, format, type),

    detectInstalls: detect,

    async availability(): Promise<VanillaAvailability[]> {
      const installs = await detect()
      const newest = latest(table)
      const result: VanillaAvailability[] = []
      for (const version of supportedVersions(table, now())) {
        const base = {
          versionId: version.id,
          releaseTime: version.releaseTime,
          isLatest: version.id === newest.id
        }
        if (await indexExists(version.id)) {
          result.push({ ...base, state: 'ready' })
          continue
        }
        const jarPath = await localJar(version.id, installs)
        result.push(
          jarPath ? { ...base, state: 'local', jarPath } : { ...base, state: 'downloadable' }
        )
      }
      return result
    },

    prepare(versionId, { allowDownload, onProgress }): Promise<VanillaIndex> {
      const version = knownVersion(versionId)
      if (!version) {
        return Promise.reject(
          new AppErrorException(VanillaErrorCode.versionUnknown, { version: versionId })
        )
      }
      const running = inflight.get(versionId)
      if (running) {
        if (onProgress) running.listeners.add(onProgress)
        return running.promise
      }
      const listeners = new Set<ProgressFn>(onProgress ? [onProgress] : [])
      const progress: ProgressFn = (phase, done, total) => {
        for (const listener of listeners) listener(phase, done, total)
      }
      const promise = runPrepare(version, allowDownload, progress)
        .catch((err: unknown) => {
          throw toAppErrorException(err)
        })
        .finally(() => inflight.delete(versionId))
      inflight.set(versionId, { promise, listeners })
      return promise
    },

    getIndex,

    prepareData(versionId) {
      if (!knownVersion(versionId)) return Promise.resolve(false)
      let p = dataInflight.get(versionId)
      if (!p) {
        p = addData(versionId).finally(() => dataInflight.delete(versionId))
        dataInflight.set(versionId, p)
      }
      return p
    },

    entityModels(versionId) {
      if (!knownVersion(versionId)) return Promise.resolve(null)
      let p = modelsCache.get(versionId)
      if (!p) {
        p = loadEntityModels(versionId)
        modelsCache.set(versionId, p)
        // Not extracted yet / jar missing: try again next time.
        void p.then((m) => {
          if (!m) modelsCache.delete(versionId)
        })
      }
      return p
    },

    resolveFile(versionId, packPath): string | null {
      if (!knownVersion(versionId)) return null
      if (packPath === INDEX_FILE || packPath === `${INDEX_FILE}.tmp`) return null
      const root = versionDir(versionId)
      const target = resolveInside(root, packPath)
      if (!target || !existsSync(join(root, INDEX_FILE))) return null
      try {
        return statSync(target).isFile() ? target : null
      } catch {
        return null
      }
    },

    async inspectPath(path) {
      const supportedIds = supportedVersions(table, now()).map((v) => v.id)
      return scanManualPath(path, supportedIds, fs)
    }
  }
}
