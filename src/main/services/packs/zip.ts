import { zipSync, type ZipOptions } from 'fflate'
import { comparePaths } from './paths'
import type { PackFile } from './validation'

/**
 * Fixed entry timestamp. fflate encodes DOS times from local-time getters, so a date built from local
 * components encodes to the same bytes in every time zone.
 */
const FIXED_MTIME = new Date(2000, 0, 1, 0, 0, 0)

/** Root files first (pack.mcmeta, pack.png), then everything else in code-point order. */
function entryOrder(a: string, b: string): number {
  const rank = (p: string): number => (p === 'pack.mcmeta' ? 0 : p === 'pack.png' ? 1 : 2)
  return rank(a) - rank(b) || comparePaths(a, b)
}

/**
 * Builds a reproducible zip: sorted entries, forward slashes, fixed timestamps, no directory entries.
 * PNGs are stored (already compressed), everything else is deflated.
 */
export function buildDeterministicZip(files: readonly PackFile[]): Uint8Array {
  const sorted = [...files].sort((a, b) => entryOrder(a.path, b.path))
  const zippable: Record<string, [Uint8Array, ZipOptions]> = {}
  for (const file of sorted) {
    const path = file.path.replace(/\\/g, '/')
    zippable[path] = [file.data, { level: path.endsWith('.png') ? 0 : 9, mtime: FIXED_MTIME }]
  }
  return zipSync(zippable, { mtime: FIXED_MTIME, os: 0, attrs: 0 })
}
