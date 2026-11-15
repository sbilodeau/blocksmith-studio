import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

/** OS clutter that never belongs in a pack (compared on the last path segment, case-insensitive). */
const JUNK_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', 'ehthumbs.db'])

/** True for macOS/Windows clutter: __MACOSX/ folders, .DS_Store, Thumbs.db, desktop.ini, AppleDouble files. */
export function isJunkPath(path: string): boolean {
  const segments = path.split('/')
  if (segments.some((s) => s === '__MACOSX')) return true
  const last = segments[segments.length - 1] ?? ''
  return JUNK_NAMES.has(last.toLowerCase()) || last.startsWith('._')
}

/** True when any segment is hidden (".blocksmith", ".git", ".gitignore"...). */
export function isHiddenPath(path: string): boolean {
  return path.split('/').some((s) => s.startsWith('.'))
}

/**
 * Zip-slip check for an archive entry name. Rejects absolute paths (POSIX, Windows drive or UNC), backslashes,
 * NUL bytes, empty segments and any "." / ".." segment. Directory entries keep their trailing slash.
 */
export function isUnsafeArchivePath(name: string): boolean {
  if (name.length === 0 || name.length > 1024) return true
  if (name.includes('\\') || name.includes('\0')) return true
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return true
  const segments = (name.endsWith('/') ? name.slice(0, -1) : name).split('/')
  return segments.some((s) => s === '' || s === '.' || s === '..')
}

/** Resource location characters accepted by Minecraft for paths under assets/. */
export function isValidResourcePath(path: string): boolean {
  return /^[a-z0-9_.\-/]+$/.test(path)
}

/** Lowercase ASCII slug for folder and file names ("Fire Pack!" -> "fire-pack"). */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return slug || 'pack'
}

/** Creates `<parent>/<base>` or `<parent>/<base>-2`, `-3`... atomically and returns the folder name. */
export async function createUniqueFolder(parent: string, base: string): Promise<string> {
  await fs.mkdir(parent, { recursive: true })
  for (let n = 1; n < 10_000; n++) {
    const name = n === 1 ? base : `${base}-${n}`
    try {
      await fs.mkdir(join(parent, name))
      return name
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error(`no free folder name for ${base}`)
}

/** True when `child` is `root` itself or inside it (both absolute, already normalized). */
export function isInside(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

export interface ScannedFile {
  /** POSIX path relative to the scanned base (prefixed with `prefix`). */
  path: string
  abs: string
  size: number
  mtimeMs: number
}

/**
 * Lists regular files under `dir` recursively. Hidden entries (".blocksmith", ".git"...) and OS junk are skipped,
 * symbolic links are ignored. Returns [] when `dir` does not exist. Paths are POSIX, prefixed with `prefix`.
 */
export async function scanFiles(dir: string, prefix = ''): Promise<ScannedFile[]> {
  const out: ScannedFile[] = []
  async function walk(abs: string, rel: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    const subdirs: Promise<void>[] = []
    const stats: Promise<void>[] = []
    for (const entry of entries) {
      const name = entry.name
      if (name.startsWith('.') || isJunkPath(name)) continue
      const childAbs = join(abs, name)
      const childRel = `${rel}${name}`
      if (entry.isDirectory()) {
        subdirs.push(walk(childAbs, `${childRel}/`))
      } else if (entry.isFile()) {
        stats.push(
          fs.stat(childAbs).then((st) => {
            out.push({ path: childRel, abs: childAbs, size: st.size, mtimeMs: st.mtimeMs })
          })
        )
      }
    }
    await Promise.all([...subdirs, ...stats])
  }
  await walk(dir, prefix)
  out.sort((a, b) => comparePaths(a.path, b.path))
  return out
}

/** Code-point string comparison (locale independent, for deterministic ordering). */
export function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
