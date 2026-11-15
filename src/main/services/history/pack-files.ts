import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { AppErrorException } from '../../ipc/registry'
import { writeFileAtomic } from '../packs/files'
import { isHiddenPath, isInside, isUnsafeArchivePath } from '../packs/paths'

/** Thrown when a pack-relative path resolves outside the pack folder (symbolic link). */
export const UNSAFE_PATH_CODE = 'packs.unsafePath'

/**
 * Absolute path of a pack-relative POSIX path, or null when the path is not a safe pack file path
 * (absolute, traversal, empty segments, backslashes, hidden segments such as `.blocksmith/`).
 */
export function resolvePackFile(folder: string, path: string): string | null {
  if (isUnsafeArchivePath(path) || path.endsWith('/') || isHiddenPath(path)) return null
  const abs = join(folder, ...path.split('/'))
  return isInside(folder, abs) && abs !== folder ? abs : null
}

/**
 * Refuses paths whose nearest existing ancestor resolves (symbolic links followed) outside the pack folder,
 * and files that are themselves symbolic links, so a write never lands outside the pack.
 */
export async function assertInsidePack(folder: string, abs: string, path: string): Promise<void> {
  const root = await fs.realpath(folder)
  try {
    const st = await fs.lstat(abs)
    if (st.isSymbolicLink() || !st.isFile()) throw new AppErrorException(UNSAFE_PATH_CODE, { path })
  } catch (err) {
    if (err instanceof AppErrorException) throw err
  }
  let dir = dirname(abs)
  for (;;) {
    try {
      const real = await fs.realpath(dir)
      if (!isInside(root, real)) throw new AppErrorException(UNSAFE_PATH_CODE, { path })
      return
    } catch (err) {
      if (err instanceof AppErrorException) throw err
      const parent = dirname(dir)
      if (parent === dir) throw err
      dir = parent
    }
  }
}

/** Reads a file into a plain Uint8Array, or null when it does not exist. */
export async function readOptional(abs: string | null): Promise<Uint8Array | null> {
  if (!abs) return null
  try {
    const data = await fs.readFile(abs)
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return null
    throw err
  }
}

/** Writes `data` atomically (creating folders), or deletes the file when `data` is null. */
export async function writeOrDelete(abs: string, data: Uint8Array | null): Promise<void> {
  if (data) await writeFileAtomic(abs, data)
  else await fs.rm(abs, { force: true })
}
