import {
  SUPPORT_WINDOW_MONTHS,
  type McVersion,
  type PackFormat,
  type VersionTable
} from '../model/versions'

function releaseMs(version: McVersion): number {
  return Date.parse(version.releaseTime)
}

export function isSnapshot(version: McVersion): boolean {
  return version.type === 'snapshot'
}

function releases(table: VersionTable): McVersion[] {
  return table.versions.filter((v) => !isSnapshot(v))
}

/** Versions sorted newest first (by release time; the table order is not trusted). */
export function sortNewestFirst(versions: readonly McVersion[]): McVersion[] {
  return [...versions].sort((a, b) => releaseMs(b) - releaseMs(a))
}

/** The most recent release of the table (snapshots excluded). Throws if the table has no release. */
export function latest(table: VersionTable): McVersion {
  const [newest] = sortNewestFirst(releases(table))
  if (!newest) throw new Error('The version table has no release')
  return newest
}

/** Start of the support window: `now` minus SUPPORT_WINDOW_MONTHS calendar months (UTC). */
export function supportWindowStart(now: Date, months = SUPPORT_WINDOW_MONTHS): Date {
  const start = new Date(now.getTime())
  const day = start.getUTCDate()
  start.setUTCDate(1)
  start.setUTCMonth(start.getUTCMonth() - months)
  // Clamp to the last day of the target month (e.g. Mar 31 - 1 month = Feb 28/29, not Mar 3).
  const lastDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)
  ).getUTCDate()
  start.setUTCDate(Math.min(day, lastDay))
  return start
}

/**
 * Releases inside the support window: releaseTime within the last SUPPORT_WINDOW_MONTHS months (boundary
 * inclusive), plus the latest release even if it is older. Newest first.
 */
export function supportedVersions(table: VersionTable, now: Date): McVersion[] {
  const startMs = supportWindowStart(now).getTime()
  const newest = latest(table)
  return sortNewestFirst(releases(table)).filter((v) => v === newest || releaseMs(v) >= startMs)
}

/** Snapshots newer than the latest release (export targets), newest first. */
export function snapshotTargets(table: VersionTable): McVersion[] {
  const newestMs = releaseMs(latest(table))
  return sortNewestFirst(table.versions).filter((v) => isSnapshot(v) && releaseMs(v) > newestMs)
}

/**
 * Export targets offered for a pack authored against `authoring` (newest first): snapshots newer than it, then every
 * release of the support window (texture paths are migrated, see migrations.ts), plus the authoring version when it
 * is older than the window. tests/real-jar/pack-compat.test.ts checks these exports in real game jars.
 */
export function exportTargets(
  table: VersionTable,
  authoring: McVersion,
  now: Date = new Date()
): McVersion[] {
  const snapshots = snapshotTargets(table).filter((v) => canExportTo(authoring, v))
  const releases = supportedVersions(table, now)
  if (!releases.some((v) => v.id === authoring.id)) releases.push(authoring)
  return [...snapshots, ...releases]
}

/**
 * Whether a pack authored against `authoring` can be exported to `target`: the authoring version itself, a snapshot
 * newer than it, or another release (main also requires a migration chain and the support window).
 */
export function canExportTo(authoring: McVersion, target: McVersion): boolean {
  if (target.id === authoring.id) return true
  if (isSnapshot(target)) return releaseMs(target) > releaseMs(authoring)
  return true
}

export function findVersion(table: VersionTable, versionId: string): McVersion | undefined {
  return table.versions.find((v) => v.id === versionId)
}

/**
 * Release whose resource pack format has the same major number as `format`. When several releases share it
 * (e.g. 1.21.7 and 1.21.8 are both 64), the newest one is returned.
 */
export function versionForPackFormat(
  table: VersionTable,
  format: Pick<PackFormat, 'major'>
): McVersion | undefined {
  return sortNewestFirst(releases(table)).find((v) => v.resourcePack.major === format.major)
}

/** Compares two pack formats: negative if a < b, 0 if equal, positive if a > b. */
export function comparePackFormats(a: PackFormat, b: PackFormat): number {
  return a.major !== b.major ? a.major - b.major : a.minor - b.minor
}
