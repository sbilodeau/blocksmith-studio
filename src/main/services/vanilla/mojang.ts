/**
 * Client jar download from Mojang: version manifest -> version JSON -> downloads.client { url, sha1, size }.
 * The jar is streamed to `<dest>.part`, its SHA1 and size are verified, then it is renamed to `<dest>`.
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { VanillaError, VanillaErrorCode } from './errors'

export const VERSION_MANIFEST_URL =
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

/** Subset of the WHATWG fetch used here (Electron's net.fetch in the app, Node's fetch in tests). */
export type FetchLike = (url: string) => Promise<Response>

export type DownloadProgress = (phase: 'download', done: number, total: number) => void

export interface MojangClient {
  /** Downloads the client jar of `versionId` to `destPath`. Throws VanillaError on failure. */
  downloadClientJar(
    versionId: string,
    destPath: string,
    onProgress?: DownloadProgress
  ): Promise<void>
}

interface ClientDownload {
  url: string
  sha1: string
  size: number
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createMojangClient({
  fetch,
  manifestUrl = VERSION_MANIFEST_URL
}: {
  fetch: FetchLike
  manifestUrl?: string
}): MojangClient {
  async function getJson(url: string, version: string): Promise<unknown> {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (err) {
      throw new VanillaError(VanillaErrorCode.downloadFailed, { version, reason: reason(err) })
    }
  }

  async function clientDownload(versionId: string): Promise<ClientDownload> {
    const manifest = (await getJson(manifestUrl, versionId)) as {
      versions?: Array<{ id?: unknown; url?: unknown }>
    }
    const entry = manifest?.versions?.find((v) => v.id === versionId)
    if (!entry || typeof entry.url !== 'string') {
      throw new VanillaError(VanillaErrorCode.versionUnknown, { version: versionId })
    }
    const meta = (await getJson(entry.url, versionId)) as {
      downloads?: { client?: Partial<ClientDownload> }
    }
    const client = meta?.downloads?.client
    if (
      !client ||
      typeof client.url !== 'string' ||
      !/^https?:\/\//.test(client.url) ||
      typeof client.sha1 !== 'string' ||
      !/^[0-9a-f]{40}$/i.test(client.sha1) ||
      typeof client.size !== 'number'
    ) {
      throw new VanillaError(VanillaErrorCode.downloadFailed, {
        version: versionId,
        reason: 'no client download in version JSON'
      })
    }
    return { url: client.url, sha1: client.sha1.toLowerCase(), size: client.size }
  }

  async function downloadClientJar(
    versionId: string,
    destPath: string,
    onProgress: DownloadProgress = () => {}
  ): Promise<void> {
    const client = await clientDownload(versionId)
    const partPath = `${destPath}.part`
    await mkdir(dirname(destPath), { recursive: true })

    const hash = createHash('sha1')
    let transferred = 0
    try {
      const response = await fetch(client.url)
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      const body = response.body
      onProgress('download', 0, client.size)
      const chunks = async function* (): AsyncGenerator<Uint8Array> {
        const reader = body.getReader()
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) return
            hash.update(value)
            transferred += value.byteLength
            onProgress('download', transferred, client.size)
            yield value
          }
        } finally {
          reader.releaseLock()
        }
      }
      await pipeline(chunks, createWriteStream(partPath))
    } catch (err) {
      await rm(partPath, { force: true })
      throw new VanillaError(VanillaErrorCode.downloadFailed, {
        version: versionId,
        reason: reason(err)
      })
    }

    if (transferred !== client.size || hash.digest('hex') !== client.sha1) {
      await rm(partPath, { force: true })
      throw new VanillaError(VanillaErrorCode.checksumMismatch, { version: versionId })
    }
    await rename(partPath, destPath)
  }

  return { downloadClientJar }
}
