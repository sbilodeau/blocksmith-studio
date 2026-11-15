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
