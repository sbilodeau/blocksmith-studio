import { join, relative, resolve, sep, isAbsolute } from 'node:path'

const MAX_PATH_LENGTH = 512

/**
 * True for a clean POSIX relative path such as "assets/minecraft/textures/block/stone.png":
 * no backslash, no NUL, not absolute (no leading "/" or drive letter), no empty, "." or ".." segment.
 * Used for zip entry names (zip-slip protection) and for paths received from the renderer.
 */
export function isSafeRelativePath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) return false
  if (path.includes('\\') || path.includes('\0')) return false
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/**
 * Joins a safe relative POSIX path to `root` and returns the absolute result, or null if the path is unsafe
 * or would end up outside `root` (defense in depth on top of isSafeRelativePath).
 */
export function resolveInside(root: string, relativePath: string): string | null {
  if (!isSafeRelativePath(relativePath)) return null
  const base = resolve(root)
  const target = resolve(join(base, ...relativePath.split('/')))
  const rel = relative(base, target)
  if (rel === '' || isAbsolute(rel) || rel.split(sep).includes('..')) {
    return null
  }
  return target
}

/** Version ids used as folder names (userData/vanilla/<id>, userData/jars/<id>.jar). */
export function isSafeVersionId(versionId: string): boolean {
  return /^[0-9][0-9a-z.-]{0,31}$/.test(versionId) && !versionId.includes('..')
}
