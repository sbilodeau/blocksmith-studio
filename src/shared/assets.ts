/**
 * URLs for the read-only `bs-asset://` protocol served by main (src/main/protocol.ts).
 *
 *   bs-asset://pack/<packId>/<path>        file from the pack folder, falling back to the pack's vanilla version
 *   bs-asset://vanilla/<versionId>/<path>  file from the extracted vanilla cache
 *
 * `path` is a POSIX path relative to the pack root (e.g. assets/minecraft/textures/block/stone.png).
 * An optional `v` query parameter busts the browser cache when a file changes.
 */
export const ASSET_SCHEME = 'bs-asset'

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function packAssetUrl(packId: string, path: string, version?: string): string {
  const v = version ? `?v=${encodeURIComponent(version)}` : ''
  return `${ASSET_SCHEME}://pack/${encodeURIComponent(packId)}/${encodePath(path)}${v}`
}

export function vanillaAssetUrl(versionId: string, path: string): string {
  return `${ASSET_SCHEME}://vanilla/${encodeURIComponent(versionId)}/${encodePath(path)}`
}

export type ParsedAssetUrl =
  | { kind: 'pack'; packId: string; path: string }
  | { kind: 'vanilla'; versionId: string; path: string }

/** Parses and validates an asset URL. Returns null for anything malformed or trying to escape its root. */
export function parseAssetUrl(url: string): ParsedAssetUrl | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${ASSET_SCHEME}:`) return null
  const host = parsed.hostname
  const segments = parsed.pathname.split('/').filter((s) => s.length > 0)
  if (segments.length < 2) return null
  let decoded: string[]
  try {
    decoded = segments.map(decodeURIComponent)
  } catch {
    return null
  }
  const [root, ...rest] = decoded
  if (
    rest.some(
      (s) => s === '..' || s === '.' || s.includes('\\') || s.includes('/') || s.includes('\0')
    )
  ) {
    return null
  }
  const path = rest.join('/')
  if (host === 'pack') return { kind: 'pack', packId: root, path }
  if (host === 'vanilla') return { kind: 'vanilla', versionId: root, path }
  return null
}

/**
 * Thumbnails: `thumb=<size>` asks main for a downscaled PNG that fits in size x size (an animated strip shows its
 * first frame), so a grid of 512 px textures does not decode and keep full-size images.
 */
export const THUMBNAIL_SIZES = [64, 128, 256] as const
export type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number]

export function isThumbnailSize(value: number): value is ThumbnailSize {
  return (THUMBNAIL_SIZES as readonly number[]).includes(value)
}

/**
 * Thumbnail size for a texture shown at `displayPx` device pixels, or null when the original is small enough to
 * be used as it is (decoded, it is at most four times the thumbnail).
 */
export function thumbnailSizeFor(
  displayPx: number,
  width: number,
  height: number
): ThumbnailSize | null {
  const size =
    THUMBNAIL_SIZES.find((s) => s >= displayPx) ?? THUMBNAIL_SIZES[THUMBNAIL_SIZES.length - 1]
  return width * height > 4 * size * size ? size : null
}

/** Adds the thumbnail parameter to an asset URL. */
export function withThumbnail(url: string, size: ThumbnailSize): string {
  return `${url}${url.includes('?') ? '&' : '?'}thumb=${size}`
}

/** Thumbnail size requested by an asset URL, or null. */
export function thumbnailParam(url: string): ThumbnailSize | null {
  const match = /[?&]thumb=(\d+)(?:&|$)/.exec(url)
  const size = match ? Number(match[1]) : NaN
  return isThumbnailSize(size) ? size : null
}
