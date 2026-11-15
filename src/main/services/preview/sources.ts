import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { VanillaIndex } from '@shared/model/vanilla'
import type { VanillaStore } from '../contracts'
import { mapLimit } from '../packs/files'
import { parseJson } from '../packs/mcmeta'
import { scanFiles, type ScannedFile } from '../packs/paths'
import type { ModelFiles } from './block-index'

/** Parallel file reads while loading models (keeps file descriptors bounded). */
const READ_CONCURRENCY = 64

const MODEL_FILE = /^assets\/([^/]+)\/(models|blockstates)\/(.+)\.json$/

/** "assets/minecraft/models/block/stone.json" -> { kind: "models", id: "minecraft:block/stone" } */
export function modelFileId(path: string): { kind: 'models' | 'blockstates'; id: string } | null {
  const m = MODEL_FILE.exec(path)
  if (!m) return null
  return { kind: m[2] as 'models' | 'blockstates', id: `${m[1]}:${m[3]}` }
}

async function readJson(abs: string): Promise<unknown> {
  try {
    const parsed = parseJson(await fs.readFile(abs))
    return parsed === undefined ? null : parsed
  } catch {
    return null
  }
}

function emptyFiles(): ModelFiles {
  return { models: new Map(), blockstates: new Map() }
}

/** Reads every vanilla model and blockstate listed in the version's index. */
export async function loadVanillaModelFiles(
  vanilla: Pick<VanillaStore, 'resolveFile'>,
  index: VanillaIndex
): Promise<ModelFiles> {
  const out = emptyFiles()
  const items: Array<{ path: string; kind: 'models' | 'blockstates'; id: string }> = []
  for (const path of Object.keys(index.entries)) {
    const parsed = modelFileId(path)
    if (parsed) items.push({ path, ...parsed })
  }
  const values = await mapLimit(items, READ_CONCURRENCY, async ({ path }) => {
    const abs = vanilla.resolveFile(index.versionId, path)
    return abs ? readJson(abs) : undefined
  })
  items.forEach(({ kind, id }, i) => {
    if (values[i] !== undefined) out[kind].set(id, values[i])
  })
  return out
}

/** Model and blockstate JSON files of a pack folder (assets/<ns>/{models,blockstates}/**), sorted by path. */
export async function scanPackModelFiles(folder: string): Promise<ScannedFile[]> {
  let namespaces: string[]
  try {
    const entries = await fs.readdir(join(folder, 'assets'), { withFileTypes: true })
    namespaces = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
  } catch {
    return []
  }
  const lists = await Promise.all(
    namespaces.flatMap((ns) =>
      (['models', 'blockstates'] as const).map((kind) =>
        scanFiles(join(folder, 'assets', ns, kind), `assets/${ns}/${kind}/`)
      )
    )
  )
  return lists
    .flat()
    .filter((f) => modelFileId(f.path) !== null)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** Change signature of scanned pack files: any add, delete, size or mtime change gives a new value. */
export function filesSignature(files: readonly ScannedFile[]): string {
  return files.map((f) => `${f.path}|${f.size}|${f.mtimeMs}`).join('\n')
}

/** Reads scanned pack files; invalid JSON is kept as null (it overrides vanilla, like in game). */
export async function loadPackModelFiles(files: readonly ScannedFile[]): Promise<ModelFiles> {
  const out = emptyFiles()
  const values = await mapLimit(files, READ_CONCURRENCY, (f) => readJson(f.abs))
  files.forEach((f, i) => {
    const parsed = modelFileId(f.path)
    if (parsed) out[parsed.kind].set(parsed.id, values[i])
  })
  return out
}

/** Pack files layered over vanilla files (same id = pack wins). */
export function overlayModelFiles(base: ModelFiles, top: ModelFiles): ModelFiles {
  return {
    models: new Map([...base.models, ...top.models]),
    blockstates: new Map([...base.blockstates, ...top.blockstates])
  }
}
