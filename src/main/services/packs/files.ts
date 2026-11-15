import { promises as fs } from 'node:fs'
import { dirname, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { sha256, type ScannedFile } from './paths'
import { readPngHeader } from './png'
import { parseJson } from './mcmeta'

export interface FileInfo {
  sha256: string
  /** PNG only (from IHDR). */
  width?: number
  height?: number
  /** .mcmeta / .json only: parsed content (undefined when invalid). */
  json?: unknown
}

/**
 * Per-file hash/metadata cache keyed by absolute path and invalidated by size + mtime, so a texture index
 * refresh only re-reads files that changed.
 */
export class FileInfoCache {
  private readonly entries = new Map<string, { size: number; mtimeMs: number; info: FileInfo }>()

  async get(file: ScannedFile): Promise<FileInfo> {
    const hit = this.entries.get(file.abs)
    if (hit && hit.size === file.size && hit.mtimeMs === file.mtimeMs) return hit.info
    const data = await fs.readFile(file.abs)
    const info: FileInfo = { sha256: sha256(data) }
    if (file.path.endsWith('.png')) {
      const header = readPngHeader(data)
      if (header) {
        info.width = header.width
        info.height = header.height
      }
    } else if (file.path.endsWith('.mcmeta') || file.path.endsWith('.json')) {
      info.json = parseJson(data)
    }
    this.entries.set(file.abs, { size: file.size, mtimeMs: file.mtimeMs, info })
    return info
  }

  /** Drops the entry of one absolute file path (file rewritten in-process). */
  delete(abs: string): void {
    this.entries.delete(abs)
  }

  /** Drops every entry under an absolute folder path (pack deleted or workspace changed). */
  forget(folderAbs: string): void {
    const prefix = folderAbs.endsWith(sep) ? folderAbs : folderAbs + sep
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }
}

/** Runs `fn` over `items` with at most `limit` calls in flight (keeps file descriptors bounded). */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Writes a file atomically (temp file in the same folder, then rename), creating parent folders. */
export async function writeFileAtomic(path: string, data: Uint8Array | string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, path)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}
