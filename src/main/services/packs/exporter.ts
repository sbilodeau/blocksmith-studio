import { promises as fs } from 'node:fs'
import type { ExportPackType, ExportReport } from '@shared/model/pack'
import type { McVersion } from '@shared/model/versions'
import { buildResourcePackMcmeta, type McmetaOptions } from '@shared/versions/mcmeta'
import { isSnapshot } from '@shared/versions/support'
import { exportItemFiles, itemFormatFor } from '@shared/items'
import { PathMigrator, canMigrate } from '@shared/versions/migrations'
import type { ProgressFn, VanillaStore } from '../contracts'
import { mapLimit, writeFileAtomic } from './files'
import { mergeMcmeta, parseJson, toJsonBytes } from './mcmeta'
import { scanFiles, sha256 } from './paths'
import type { PackLocation } from './project'
import { dataSchemaWarnings, validatePackFiles, type PackFile } from './validation'
import { buildDeterministicZip } from './zip'

/** Warning codes added by the exporter itself (validation codes live in validation.ts). */
export const ExportWarningCode = {
  vanillaNotReady: 'export.vanillaNotReady',
  invalidMcmeta: 'export.invalidMcmeta',
  /** Resource pack export: the pack's data/ files were left out (they belong in a data pack). */
  dataLeftOut: 'export.dataLeftOut',
  /** Export to another version: models, blockstates and other JSON files are copied as they are. */
  otherFilesAsIs: 'export.otherFilesAsIs',
  /** Data pack export: textures and other assets/ files were left out (data packs cannot contain them). */
  assetsLeftOut: 'export.assetsLeftOut',
  /** Data pack export: the pack has no data/ file, so the data pack is empty. */
  noDataFiles: 'export.noDataFiles',
  /** Data pack export to another version: data files are copied as they are (their format may differ there). */
  dataAsIs: 'export.dataAsIs'
} as const

export interface ExportOptions extends McmetaOptions {
  packType?: ExportPackType
}

/** Top-level folders kept per pack type (pack.mcmeta and pack.png are always written). */
function belongsTo(packType: ExportPackType, path: string): boolean {
  if (path === 'pack.png') return true
  return packType === 'data' ? path.startsWith('data/') : !path.startsWith('data/')
}

/** ExportReport.skipped reasons. */
export const ExportSkipReason = {
  identicalToVanilla: 'identicalToVanilla',
  /** The texture does not exist in the target version (added after it, or removed before it). */
  notInTarget: 'notInTarget'
} as const

export interface ExportDeps {
  vanilla: VanillaStore
  onProgress: ProgressFn
}

/** What a pack exports to for one target and pack type, before it is zipped (or copied as a folder). */
export interface CollectedExport {
  files: PackFile[]
  packType: ExportPackType
  renamed: number
  skipped: ExportReport['skipped']
  warnings: ExportReport['warnings']
}

/**
 * Collects the files a pack exports to for `target` (see exportPackZip): the same list whether it ends up in a zip
 * (export, install in Minecraft) or in a folder (live mode).
 */
export async function collectExportFiles(
  location: PackLocation,
  target: McVersion,
  deps: ExportDeps,
  options: ExportOptions = {}
): Promise<CollectedExport> {
  const packType = options.packType ?? 'resource'
  const { vanilla, onProgress } = deps
  const warnings: ExportReport['warnings'] = []
  const skipped: ExportReport['skipped'] = []

  const scanned = await scanFiles(location.folder)
  onProgress('collect', 0, scanned.length)

  const authoring = location.project.authoringVersion
  // Another version: texture paths are migrated along the chain (renames, textures missing in the target).
  const migrator =
    target.id !== authoring && canMigrate(authoring, target.id)
      ? new PathMigrator(authoring, target.id)
      : null
  // Snapshots are not extracted: compare with the authoring version's vanilla (paths before migration).
  const snapshotTarget = isSnapshot(target)
  // Data files identical to vanilla are left out too: caches extracted before data support get it now.
  if (packType === 'data') await vanilla.prepareData(snapshotTarget ? authoring : target.id)
  const index = await vanilla.getIndex(snapshotTarget ? authoring : target.id)
  if (!index) warnings.push({ code: ExportWarningCode.vanillaNotReady })

  let existingMcmeta: unknown
  let collected = 0
  const read = await mapLimit(scanned, 32, async (file) => {
    const data = new Uint8Array(await fs.readFile(file.abs))
    onProgress('collect', ++collected, scanned.length)
    return { path: file.path, data }
  })
  // Custom items (M14): their files are generated again in the target's format; blocksmith/ is left out.
  const items = exportItemFiles(read, itemFormatFor(target))
  for (const path of items.invalid) warnings.push({ code: 'items.invalidDefinition', path })
  const loaded = items.files

  const files: PackFile[] = []
  let leftOut = 0
  let renamed = 0
  let otherAssets = false
  for (const loadedFile of loaded) {
    let file = loadedFile
    if (file.path === 'pack.mcmeta') {
      existingMcmeta = parseJson(file.data)
      if (existingMcmeta === undefined) {
        warnings.push({ code: ExportWarningCode.invalidMcmeta, path: 'pack.mcmeta' })
      }
      continue
    }
    if (!belongsTo(packType, file.path)) {
      leftOut++
      continue
    }
    const vanillaPath = file.path
    if (migrator) {
      const r = migrator.migrateFile(file.path)
      if (!('path' in r)) {
        skipped.push({ path: file.path, reason: ExportSkipReason.notInTarget })
        continue
      }
      if (r.renamed) {
        renamed++
        file = { ...file, path: r.path }
      } else if (
        file.path.startsWith('assets/') &&
        !file.path.startsWith('assets/minecraft/textures/') &&
        !/\/lang\/[^/]+\.json$/.test(file.path)
      ) {
        otherAssets = true
      }
    }
    const vanillaEntry =
      file.path === 'pack.png'
        ? undefined
        : index?.entries[snapshotTarget ? vanillaPath : file.path]
    if (vanillaEntry && vanillaEntry.sha256 === sha256(file.data)) {
      skipped.push({ path: file.path, reason: ExportSkipReason.identicalToVanilla })
      continue
    }
    files.push(file)
  }

  if (leftOut > 0) {
    warnings.push({
      code: packType === 'data' ? ExportWarningCode.assetsLeftOut : ExportWarningCode.dataLeftOut
    })
  }
  if (otherAssets) warnings.push({ code: ExportWarningCode.otherFilesAsIs })
  const dataFiles = files.filter((f) => f.path.startsWith('data/'))
  if (packType === 'data' && dataFiles.length === 0) {
    warnings.push({ code: ExportWarningCode.noDataFiles })
  }
  if (packType === 'data' && dataFiles.length > 0 && target.id !== authoring) {
    warnings.push({ code: ExportWarningCode.dataAsIs })
  }

  const mcmeta = mergeMcmeta(
    buildResourcePackMcmeta(location.project.description, target, { ...options, packType }),
    existingMcmeta
  )
  files.push({ path: 'pack.mcmeta', data: toJsonBytes(mcmeta) })

  warnings.push(...validatePackFiles(files))
  if (packType === 'data') {
    warnings.push(...dataSchemaWarnings(files, index ? Object.keys(index.entries) : []))
  }
  return { files, packType, renamed, skipped, warnings }
}

/**
 * Exports a pack folder as a resource pack zip (default) or a data pack zip for `target` (the authoring version, or a
 * newer snapshot). A resource pack gets everything but data/; a data pack gets only data/ (Minecraft never loads
 * textures from a data pack) and the target's data pack format.
 * - collects the pack files, excluding hidden entries (.blocksmith/, .git...), OS junk and files byte-identical to
 *   the target's vanilla (Minecraft falls back to vanilla for those). For a snapshot target the authoring
 *   version's vanilla is used: snapshots are not extracted.
 * - regenerates pack.mcmeta for the target, keeping extra top-level sections of the pack's own file
 * - validates (Pack Doctor basics) and writes a deterministic zip
 */
export async function exportPackZip(
  location: PackLocation,
  target: McVersion,
  outputPath: string,
  deps: ExportDeps,
  options: ExportOptions = {}
): Promise<ExportReport> {
  const { files, packType, renamed, skipped, warnings } = await collectExportFiles(
    location,
    target,
    deps,
    options
  )
  const { onProgress } = deps
  onProgress('write', 0, 1)
  const zip = buildDeterministicZip(files)
  await writeFileAtomic(outputPath, zip)
  onProgress('write', 1, 1)

  return {
    outputPath,
    targetVersion: target.id,
    packType,
    renamed,
    filesWritten: files.length,
    sizeBytes: zip.byteLength,
    skipped,
    warnings
  }
}
