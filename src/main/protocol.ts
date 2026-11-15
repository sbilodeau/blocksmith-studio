import { promises as fs } from 'node:fs'
import { join, sep } from 'node:path'
import { protocol } from 'electron'
import { ASSET_SCHEME, parseAssetUrl } from '@shared/assets'
import type { PackBase } from '@shared/model/pack'
import type { VanillaStore } from './services/contracts'
import { isInside } from './services/packs/paths'

/**
 * Read-only `bs-asset://` protocol (URL format in src/shared/assets.ts):
 *   bs-asset://pack/<packId>/<path>        pack file, else the pack's vanilla file (vanilla base)
 *   bs-asset://vanilla/<versionId>/<path>  extracted vanilla file
 * Only .png, .json and .mcmeta files are served; hidden paths (.blocksmith/...) and anything whose real path
 * leaves its root (symlinks included) answer 404.
 */

const CONTENT_TYPES: Array<[suffix: string, type: string]> = [
  ['.png', 'image/png'],
  ['.json', 'application/json'],
  ['.mcmeta', 'application/json']
]

export interface AssetResolverDeps {
  vanilla: Pick<VanillaStore, 'resolveFile'>
  /** Pack folder and project (PackService.locate). */
  locatePack: (
    packId: string
  ) => Promise<{ folder: string; project: { authoringVersion: string; base: PackBase } } | null>
}

export interface ResolvedAsset {
  filePath: string
  contentType: string
}

function contentTypeOf(path: string): string | null {
  const match = CONTENT_TYPES.find(([suffix]) => path.toLowerCase().endsWith(suffix))
  return match ? match[1] : null
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await fs.realpath(path)
  } catch {
    return null
  }
}

/** Real path of `root/<path>` when it is a regular file inside the real `root`; null otherwise. */
async function fileInside(root: string, filePath: string): Promise<string | null> {
  const [realRoot, realFile] = await Promise.all([realpathOrNull(root), realpathOrNull(filePath)])
  if (!realRoot || !realFile || !isInside(realRoot, realFile)) return null
  try {
    return (await fs.stat(realFile)).isFile() ? realFile : null
  } catch {
    return null
  }
}

async function resolveVanilla(
  vanilla: AssetResolverDeps['vanilla'],
  versionId: string,
  packPath: string
): Promise<string | null> {
  const file = vanilla.resolveFile(versionId, packPath)
  if (!file) return null
  // The cache root is whatever precedes the requested path; the real file must stay below it.
  const suffix = join(...packPath.split('/'))
  if (!file.endsWith(sep + suffix)) return null
  return fileInside(file.slice(0, file.length - suffix.length), file)
}

/** Pure resolution of an asset URL to a file on disk (no Electron), or null for "404". */
export async function resolveAssetUrl(
  url: string,
  deps: AssetResolverDeps
): Promise<ResolvedAsset | null> {
  const parsed = parseAssetUrl(url)
  if (!parsed) return null
  const contentType = contentTypeOf(parsed.path)
  if (!contentType) return null
  const segments = parsed.path.split('/')
  if (segments.some((s) => s.startsWith('.') || s.length === 0)) return null

  if (parsed.kind === 'vanilla') {
    const filePath = await resolveVanilla(deps.vanilla, parsed.versionId, parsed.path)
    return filePath ? { filePath, contentType } : null
  }

  const pack = await deps.locatePack(parsed.packId)
  if (!pack) return null
  const candidate = join(pack.folder, ...segments)
  const exists = await realpathOrNull(candidate)
  if (exists) {
    // Present in the pack: serve it only if it stays inside the pack folder (never fall back).
    const filePath = await fileInside(pack.folder, candidate)
    return filePath ? { filePath, contentType } : null
  }
  if (pack.project.base !== 'vanilla') return null
  const filePath = await resolveVanilla(deps.vanilla, pack.project.authoringVersion, parsed.path)
  return filePath ? { filePath, contentType } : null
}

/** Must run before app 'ready'. */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

/** Installs the bs-asset handler on the default session (after app 'ready'). */
export function handleAssetProtocol(deps: AssetResolverDeps): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const headers = { 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers })
    }
    try {
      const asset = await resolveAssetUrl(request.url, deps)
      if (asset) {
        const data = new Uint8Array(await fs.readFile(asset.filePath))
        return new Response(request.method === 'HEAD' ? null : data, {
          status: 200,
          headers: { ...headers, 'Content-Type': asset.contentType }
        })
      }
    } catch {
      // fall through to 404
    }
    return new Response(null, { status: 404, headers })
  })
}
