import { promises as fs } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import type { ImportReport, Project } from '@shared/model/pack'
import { buildResourcePackMcmeta } from '@shared/versions/mcmeta'
import type { ProgressFn, VanillaStore } from '../contracts'
import { AppErrorException } from '../../ipc/registry'
import { writeFileAtomic } from './files'
import {
  isRecord,
  mergeMcmeta,
  parseJson,
  readDeclaredFormat,
  stripFormatting,
  textComponentToPlain,
  toJsonBytes
} from './mcmeta'
import {
  createUniqueFolder,
  isHiddenPath,
  isInside,
  isJunkPath,
  isUnsafeArchivePath,
  sha256,
  slugify
} from './paths'
import { createDefaultPackIcon } from './png'
import { writeProject, type PackLocation } from './project'

export interface ImportLimits {
  maxEntries: number
  maxTotalBytes: number
  maxFileBytes: number
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxEntries: 20_000,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024
}

/** Error codes thrown by importPackZip (i18n: `errors.<code>`). */
export const ImportErrorCode = {
  invalidZip: 'import.invalidZip',
  notAPack: 'import.notAPack',
  unsafePath: 'import.unsafePath',
  tooLarge: 'import.tooLarge'
} as const

/** Warning codes in ImportReport.warnings. */
export const ImportWarningCode = {
  formatMismatch: 'import.formatMismatch',
  formatMissing: 'import.formatMissing',
  vanillaNotReady: 'import.vanillaNotReady'
} as const

export interface ImportDeps {
  vanilla: VanillaStore
  packsDir: string
  packId: string
  now: Date
  onProgress: ProgressFn
  limits?: ImportLimits
}

export interface ImportResult {
  location: PackLocation
  report: Omit<ImportReport, 'pack'>
}

/** Reads the zip with size / entry / path checks applied before anything is decompressed. */
function readZipEntries(data: Uint8Array, limits: ImportLimits): Record<string, Uint8Array> {
  let count = 0
  let total = 0
  try {
    return unzipSync(data, {
      filter(file) {
        count++
        if (count > limits.maxEntries) {
          throw new AppErrorException(ImportErrorCode.tooLarge, {
            reason: 'entries',
            limit: limits.maxEntries
          })
        }
        if (isUnsafeArchivePath(file.name)) {
          throw new AppErrorException(ImportErrorCode.unsafePath, { path: file.name.slice(0, 200) })
        }
        if (file.name.endsWith('/') || isJunkPath(file.name)) return false
        if (file.originalSize > limits.maxFileBytes) {
          throw new AppErrorException(ImportErrorCode.tooLarge, {
            reason: 'file',
            path: file.name.slice(0, 200),
            limit: limits.maxFileBytes
          })
        }
        // fflate inflates into a buffer of the declared size, so declared sizes bound memory use.
        total += file.originalSize
        if (total > limits.maxTotalBytes) {
          throw new AppErrorException(ImportErrorCode.tooLarge, {
            reason: 'total',
            limit: limits.maxTotalBytes
          })
        }
        return true
      }
    })
  } catch (err) {
    if (err instanceof AppErrorException) throw err
    throw new AppErrorException(ImportErrorCode.invalidZip)
  }
}

/** Folder prefix of the pack root: "" when pack.mcmeta is at the root, "<dir>/" when inside one top folder. */
export function findPackRoot(names: readonly string[]): string | null {
  if (names.includes('pack.mcmeta')) return ''
  const roots = new Set(
    names.filter((n) => /^[^/]+\/pack\.mcmeta$/.test(n)).map((n) => n.slice(0, n.indexOf('/') + 1))
  )
  return roots.size === 1 ? [...roots][0] : null
}

/** Pack name from the zip file name ("Fire_Pack v2.zip" -> "Fire_Pack v2"). */
export function nameFromZipPath(zipPath: string): string {
  const name = basename(zipPath)
    .replace(/\.zip$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
    .trim()
  return name || 'Imported pack'
}

/**
 * Imports a resource pack zip into a new pack folder (M1 rules):
 * authoring version = latest supported version, base = vanilla, files identical to that version's vanilla are
 * dropped (when its index is ready), pack.mcmeta is regenerated for the authoring version (extra sections kept).
 */
export async function importPackZip(zipPath: string, deps: ImportDeps): Promise<ImportResult> {
  const limits = deps.limits ?? DEFAULT_IMPORT_LIMITS
  const { vanilla, onProgress } = deps

  onProgress('read', 0, 1)
  let stat
  try {
    stat = await fs.stat(zipPath)
  } catch {
    throw new AppErrorException(ImportErrorCode.invalidZip)
  }
  if (!stat.isFile()) throw new AppErrorException(ImportErrorCode.invalidZip)
  if (stat.size > limits.maxTotalBytes) {
    throw new AppErrorException(ImportErrorCode.tooLarge, {
      reason: 'total',
      limit: limits.maxTotalBytes
    })
  }
  const entries = readZipEntries(new Uint8Array(await fs.readFile(zipPath)), limits)
  onProgress('read', 1, 1)

  const names = Object.keys(entries)
  const prefix = findPackRoot(names)
  if (prefix === null) throw new AppErrorException(ImportErrorCode.notAPack)
  const mcmeta = parseJson(entries[`${prefix}pack.mcmeta`])
  if (!isRecord(mcmeta) || !isRecord(mcmeta.pack)) {
    throw new AppErrorException(ImportErrorCode.notAPack)
  }

  const warnings: ImportReport['warnings'] = []
  const declaredFormat = readDeclaredFormat(mcmeta)
  const mapped = declaredFormat ? vanilla.versionForPackFormat(declaredFormat) : undefined
  const authoring = vanilla.latestVersion()
  if (!declaredFormat) warnings.push({ code: ImportWarningCode.formatMissing })
  else if (mapped?.id !== authoring.id) warnings.push({ code: ImportWarningCode.formatMismatch })

  const index = await vanilla.getIndex(authoring.id)
  if (!index) warnings.push({ code: ImportWarningCode.vanillaNotReady })

  // Select the files to keep.
  const kept: Array<{ path: string; data: Uint8Array }> = []
  let identicalToVanilla = 0
  for (const name of names) {
    if (!name.startsWith(prefix)) continue
    const path = name.slice(prefix.length)
    if (path === '' || path === 'pack.mcmeta' || isHiddenPath(path)) continue
    const data = entries[name]
    const vanillaEntry = path === 'pack.png' ? undefined : index?.entries[path]
    if (vanillaEntry && vanillaEntry.sha256 === sha256(data)) {
      identicalToVanilla++
      continue
    }
    kept.push({ path, data })
  }

  const description = textComponentToPlain(mcmeta.pack.description).trim().slice(0, 512)
  const name = nameFromZipPath(zipPath)
  const now = deps.now.toISOString()
  const project: Project = {
    schemaVersion: 1,
    id: deps.packId,
    name,
    description,
    authoringVersion: authoring.id,
    base: 'vanilla',
    createdAt: now,
    updatedAt: now
  }

  const folderName = await createUniqueFolder(deps.packsDir, slugify(stripFormatting(name)))
  const folder = join(deps.packsDir, folderName)
  try {
    let done = 0
    onProgress('write', 0, kept.length)
    for (const file of kept) {
      const target = resolve(folder, ...file.path.split('/'))
      if (!isInside(folder, target)) throw new AppErrorException(ImportErrorCode.unsafePath)
      await writeFileAtomic(target, file.data)
      onProgress('write', ++done, kept.length)
    }
    const packMcmeta = mergeMcmeta(buildResourcePackMcmeta(description, authoring), mcmeta)
    await writeFileAtomic(join(folder, 'pack.mcmeta'), toJsonBytes(packMcmeta))
    if (!kept.some((f) => f.path === 'pack.png')) {
      await writeFileAtomic(join(folder, 'pack.png'), createDefaultPackIcon({ seed: project.id }))
    }
    await writeProject(folder, project)
  } catch (err) {
    await fs.rm(folder, { recursive: true, force: true })
    throw err
  }

  return {
    location: { id: project.id, folder, project },
    report: {
      declaredFormat,
      mappedVersion: mapped?.id,
      filesImported: kept.length,
      identicalToVanilla,
      warnings
    }
  }
}
