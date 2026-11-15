/**
 * Vanilla jar extraction and index building. Runs inside a worker thread in the app (see extract-worker.ts) and
 * directly in tests. Must not import Electron.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { strFromU8, unzipSync, type Unzipped } from 'fflate'
import type { VanillaIndex, VanillaIndexEntry } from '@shared/model/vanilla'
import { VanillaError, VanillaErrorCode } from './errors'
import { isSafeRelativePath, resolveInside } from './paths'
import { readPngSize } from './png'
import { parseJarVersionJson } from './version-json'

export const INDEX_FILE = 'index.json'

/** Largest single entry we accept (the biggest vanilla texture is a few MB). Guards against zip bombs. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024
const WRITE_CONCURRENCY = 32
const PROGRESS_STEP = 100

export interface ExtractJob {
  jarPath: string
  /** userData/vanilla/<versionId> */
  outDir: string
  versionId: string
}

export type ExtractPhase = 'extract' | 'index'
export type ExtractProgress = (phase: ExtractPhase, done: number, total: number) => void

/** Runs an extraction job (in a worker in the app, inline in tests). */
export type ExtractRunner = (job: ExtractJob, onProgress?: ExtractProgress) => Promise<VanillaIndex>

const ASSET_DIRS = /^assets\/minecraft\/(textures|models|blockstates|items|atlases|font)\//
const SINGLE_FILES = new Set(['assets/minecraft/lang/en_us.json', 'pack.png', 'version.json'])

/**
 * True for jar entries copied to the vanilla cache: assets/minecraft/{textures,models,blockstates,items,
 * atlases,font}/**, assets/minecraft/lang/en_us.json, pack.png and version.json. Unsafe names (zip slip) and
 * directory entries are rejected.
 */
export function isExtractedAsset(name: string): boolean {
  if (!isSafeRelativePath(name)) return false
  return SINGLE_FILES.has(name) || ASSET_DIRS.test(name)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Animation info from a texture's sibling `.png.mcmeta` (frames stacked vertically). */
function animationOf(
  mcmeta: Uint8Array | undefined,
  width: number,
  height: number
): { animated: true; frameCount: number } | null {
  if (!mcmeta) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(strFromU8(mcmeta))
  } catch {
    return null
  }
  const animation = (parsed as { animation?: unknown } | null)?.animation
  if (!animation || typeof animation !== 'object') return null
  // Frame size defaults to width x width; `height` in the animation block overrides it.
  const declared = (animation as { height?: unknown }).height
  const frameHeight = typeof declared === 'number' && declared > 0 ? declared : width
  return { animated: true, frameCount: Math.max(1, Math.floor(height / frameHeight)) }
}

/** Builds one index entry from the file bytes (and its sibling .mcmeta for PNGs). */
export function indexEntry(path: string, bytes: Uint8Array, files: Unzipped): VanillaIndexEntry {
  const entry: VanillaIndexEntry = { path, sha256: sha256(bytes), size: bytes.byteLength }
  if (path.endsWith('.png')) {
    const size = readPngSize(bytes)
    if (size) {
      entry.width = size.width
      entry.height = size.height
      const animation = animationOf(files[`${path}.mcmeta`], size.width, size.height)
      if (animation) Object.assign(entry, animation)
    }
  }
  return entry
}

async function runLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  async function lane(): Promise<void> {
    while (next < items.length) {
      const item = items[next++]
      await task(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
}

function readJarEntries(bytes: Uint8Array): Unzipped {
  try {
    return unzipSync(bytes, {
      filter: (file) => isExtractedAsset(file.name) && file.originalSize <= MAX_ENTRY_BYTES
    })
  } catch (err) {
    throw new VanillaError(VanillaErrorCode.invalidJar, {
      reason: err instanceof Error ? err.message : String(err)
    })
  }
}

/**
 * Extracts the vanilla assets of a client jar into `job.outDir` and writes `index.json` LAST (tmp + rename), so a
 * folder without index.json is never considered ready. Any previous content of `job.outDir` is removed first.
 */
export async function extractVanillaJar(
  job: ExtractJob,
  onProgress: ExtractProgress = () => {},
  now: () => Date = () => new Date()
): Promise<VanillaIndex> {
  let raw: Buffer
  try {
    raw = await readFile(job.jarPath)
  } catch (err) {
    throw new VanillaError(VanillaErrorCode.invalidJar, {
      reason: err instanceof Error ? err.message : String(err)
    })
  }
  const files = readJarEntries(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))

  const versionBytes = files['version.json']
  let info: ReturnType<typeof parseJarVersionJson>
  try {
    info = versionBytes ? parseJarVersionJson(JSON.parse(strFromU8(versionBytes))) : null
  } catch {
    info = null
  }
  if (!info) throw new VanillaError(VanillaErrorCode.invalidJar, { reason: 'version.json' })
  if (info.id !== job.versionId) {
    throw new VanillaError(VanillaErrorCode.jarVersionMismatch, {
      expected: job.versionId,
      actual: info.id
    })
  }

  const paths = Object.keys(files).sort()
  const total = paths.length

  await rm(job.outDir, { recursive: true, force: true })
  await mkdir(job.outDir, { recursive: true })

  // Phase 1: write the files.
  const createdDirs = new Map<string, Promise<unknown>>()
  let written = 0
  onProgress('extract', 0, total)
  await runLimited(paths, WRITE_CONCURRENCY, async (path) => {
    const target = resolveInside(job.outDir, path)
    if (!target) return // unreachable: names were filtered by isExtractedAsset
    const dir = dirname(target)
    let created = createdDirs.get(dir)
    if (!created) {
      created = mkdir(dir, { recursive: true })
      createdDirs.set(dir, created)
    }
    await created
    await writeFile(target, files[path])
    written++
    if (written % PROGRESS_STEP === 0 || written === total) onProgress('extract', written, total)
  })

  // Phase 2: index (hashes, PNG sizes, animation flags).
  const entries: Record<string, VanillaIndexEntry> = {}
  onProgress('index', 0, total)
  paths.forEach((path, i) => {
    entries[path] = indexEntry(path, files[path], files)
    if ((i + 1) % PROGRESS_STEP === 0 || i + 1 === total) onProgress('index', i + 1, total)
  })

  const index: VanillaIndex = {
    schemaVersion: 1,
    versionId: job.versionId,
    resourcePack: info.resourcePack,
    dataPack: info.dataPack,
    createdAt: now().toISOString(),
    entries
  }
  const indexPath = join(job.outDir, INDEX_FILE)
  const tmpPath = `${indexPath}.tmp`
  await writeFile(tmpPath, JSON.stringify(index))
  await rename(tmpPath, indexPath)
  return index
}
