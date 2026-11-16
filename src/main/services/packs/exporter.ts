import { promises as fs } from 'node:fs'
import type { ExportReport } from '@shared/model/pack'
import type { McVersion } from '@shared/model/versions'
import { buildResourcePackMcmeta, type McmetaOptions } from '@shared/versions/mcmeta'
import type { ProgressFn, VanillaStore } from '../contracts'
import { mapLimit, writeFileAtomic } from './files'
import { mergeMcmeta, parseJson, toJsonBytes } from './mcmeta'
import { scanFiles, sha256 } from './paths'
import type { PackLocation } from './project'
import { validatePackFiles, type PackFile } from './validation'
import { buildDeterministicZip } from './zip'

/** Warning codes added by the exporter itself (validation codes live in validation.ts). */
export const ExportWarningCode = {
  vanillaNotReady: 'export.vanillaNotReady',
  invalidMcmeta: 'export.invalidMcmeta'
} as const

/** ExportReport.skipped reasons. */
export const ExportSkipReason = {
  identicalToVanilla: 'identicalToVanilla'
} as const

export interface ExportDeps {
  vanilla: VanillaStore
  onProgress: ProgressFn
}

/**
 * Exports a pack folder as a resource pack zip for `target` (M1: the authoring version only).
 * - collects the pack files, excluding hidden entries (.blocksmith/, .git...), OS junk and files byte-identical to
 *   the target's vanilla (Minecraft falls back to vanilla for those)
 * - regenerates pack.mcmeta for the target, keeping extra top-level sections of the pack's own file
 * - validates (Pack Doctor basics) and writes a deterministic zip
 */
export async function exportPackZip(
  location: PackLocation,
  target: McVersion,
  outputPath: string,
  deps: ExportDeps,
  options: McmetaOptions = {}
): Promise<ExportReport> {
  const { vanilla, onProgress } = deps
  const warnings: ExportReport['warnings'] = []
  const skipped: ExportReport['skipped'] = []

  const scanned = await scanFiles(location.folder)
  onProgress('collect', 0, scanned.length)

  const index = await vanilla.getIndex(target.id)
  if (!index) warnings.push({ code: ExportWarningCode.vanillaNotReady })

  let existingMcmeta: unknown
  let collected = 0
  const loaded = await mapLimit(scanned, 32, async (file) => {
    const data = new Uint8Array(await fs.readFile(file.abs))
    onProgress('collect', ++collected, scanned.length)
    return { path: file.path, data }
  })

  const files: PackFile[] = []
  for (const file of loaded) {
    if (file.path === 'pack.mcmeta') {
      existingMcmeta = parseJson(file.data)
      if (existingMcmeta === undefined) {
        warnings.push({ code: ExportWarningCode.invalidMcmeta, path: 'pack.mcmeta' })
      }
      continue
    }
    const vanillaEntry = file.path === 'pack.png' ? undefined : index?.entries[file.path]
    if (vanillaEntry && vanillaEntry.sha256 === sha256(file.data)) {
      skipped.push({ path: file.path, reason: ExportSkipReason.identicalToVanilla })
      continue
    }
    files.push(file)
  }

  const mcmeta = mergeMcmeta(
    buildResourcePackMcmeta(location.project.description, target, options),
    existingMcmeta
  )
  files.push({ path: 'pack.mcmeta', data: toJsonBytes(mcmeta) })

  warnings.push(...validatePackFiles(files))

  onProgress('write', 0, 1)
  const zip = buildDeterministicZip(files)
  await writeFileAtomic(outputPath, zip)
  onProgress('write', 1, 1)

  return {
    outputPath,
    targetVersion: target.id,
    filesWritten: files.length,
    sizeBytes: zip.byteLength,
    skipped,
    warnings
  }
}
