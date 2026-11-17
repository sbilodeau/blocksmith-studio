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

/** PNG size read from the first bytes of the file, without hashing it. */
export interface PngHeaderInfo {
  width?: number
  height?: number
  /**
   * Version token for asset URLs: the hash prefix when the file was hashed, otherwise a token that changes every
   * time the file is read again (size or mtime change, or `delete`).
   */
  version: string
}

/** IHDR ends at byte 33 (8-byte signature, chunk length and type, 13 bytes of data, CRC). */
export const PNG_HEADER_BYTES = 33

/** The first `length` bytes of a file (fewer when the file is shorter). */
export async function readFileHead(abs: string, length: number): Promise<Uint8Array> {
  const data = new Uint8Array(length)
  const handle = await fs.open(abs, 'r')
  try {
    const { bytesRead } = await handle.read(data, 0, length, 0)
    return data.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * Per-file hash/metadata cache keyed by absolute path and invalidated by size + mtime, so a texture index
 * refresh only re-reads files that changed.
 */
export class FileInfoCache {
  private readonly entries = new Map<string, { size: number; mtimeMs: number; info: FileInfo }>()
  private readonly headers = new Map<
    string,
    { size: number; mtimeMs: number; info: PngHeaderInfo }
  >()
  private headerReads = 0

  /**
   * PNG width and height from the IHDR, reading only the first bytes (a full read when the file is already
   * hashed). For files whose status does not depend on their hash (no vanilla counterpart, different size), so a
   * pack of high-resolution textures is not read and hashed in full.
   */
  async pngHeader(file: ScannedFile): Promise<PngHeaderInfo> {
    const full = this.entries.get(file.abs)
    if (full && full.size === file.size && full.mtimeMs === file.mtimeMs) {
      const { width, height, sha256: sha } = full.info
      return { width, height, version: sha.slice(0, 12) }
    }
    const hit = this.headers.get(file.abs)
    if (hit && hit.size === file.size && hit.mtimeMs === file.mtimeMs) return hit.info
    const data = await readFileHead(file.abs, PNG_HEADER_BYTES)
    // "h" is not a hex digit, so a header token never equals a hash prefix.
    const info: PngHeaderInfo = { version: `h${(++this.headerReads).toString(36)}` }
    const header = readPngHeader(data)
    if (header) {
      info.width = header.width
      info.height = header.height
    }
    this.headers.set(file.abs, { size: file.size, mtimeMs: file.mtimeMs, info })
    return info
  }

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
    this.headers.delete(abs)
  }

  /** Drops every entry under an absolute folder path (pack deleted or workspace changed). */
  forget(folderAbs: string): void {
    const prefix = folderAbs.endsWith(sep) ? folderAbs : folderAbs + sep
    for (const map of [this.entries, this.headers]) {
      for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key)
    }
  }

  clear(): void {
    this.entries.clear()
    this.headers.clear()
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
