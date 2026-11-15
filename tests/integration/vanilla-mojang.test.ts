import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { fixtureJarBytes } from '../../scripts/make-fixture-jar.mjs'
import { createMojangClient } from '../../src/main/services/vanilla/mojang'

/** Fake piston-meta / piston-data server. */
interface FakeMojang {
  baseUrl: string
  jar: Uint8Array
  /** Overrides the sha1 advertised for 26.3 (to simulate a corrupted download). */
  advertisedSha1?: string
  failJar?: boolean
  requests: string[]
}

describe('Mojang client jar download', () => {
  let server: Server
  const fake: FakeMojang = { baseUrl: '', jar: fixtureJarBytes('26.3'), requests: [] }
  let dir: string

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '/'
      fake.requests.push(url)
      const json = (value: unknown, status = 200): void => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(value))
      }
      if (url === '/mc/game/version_manifest_v2.json') {
        return json({
          latest: { release: '26.3' },
          versions: [
            { id: '26.3', type: 'release', url: `${fake.baseUrl}/v1/packages/abc/26.3.json` },
            { id: '26.2', type: 'release', url: `${fake.baseUrl}/v1/packages/def/26.2.json` }
          ]
        })
      }
      if (url === '/v1/packages/abc/26.3.json') {
        return json({
          id: '26.3',
          downloads: {
            client: {
              url: `${fake.baseUrl}/v1/objects/client.jar`,
              sha1: fake.advertisedSha1 ?? createHash('sha1').update(fake.jar).digest('hex'),
              size: fake.jar.byteLength
            }
          }
        })
      }
      if (url === '/v1/packages/def/26.2.json') return json({ id: '26.2', downloads: {} })
      if (url === '/v1/objects/client.jar') {
        if (fake.failJar) {
          res.writeHead(500)
          return res.end()
        }
        res.writeHead(200, { 'content-length': String(fake.jar.byteLength) })
        // Two chunks so progress is reported more than once.
        const half = Math.floor(fake.jar.byteLength / 2)
        res.write(fake.jar.subarray(0, half))
        setTimeout(() => res.end(fake.jar.subarray(half)), 5)
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    fake.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blocksmith-mojang-'))
    fake.advertisedSha1 = undefined
    fake.failJar = false
    fake.requests = []
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const client = (): ReturnType<typeof createMojangClient> =>
    createMojangClient({
      fetch: (url) => fetch(url),
      manifestUrl: `${fake.baseUrl}/mc/game/version_manifest_v2.json`
    })

  it('follows manifest -> version JSON -> client jar, verifies SHA1 and renames the .part file', async () => {
    const dest = join(dir, 'jars', '26.3.jar')
    const progress: Array<[string, number, number]> = []
    await client().downloadClientJar('26.3', dest, (phase, done, total) =>
      progress.push([phase, done, total])
    )
    expect(new Uint8Array(await readFile(dest))).toEqual(fake.jar)
    expect(existsSync(`${dest}.part`)).toBe(false)
    expect(fake.requests).toEqual([
      '/mc/game/version_manifest_v2.json',
      '/v1/packages/abc/26.3.json',
      '/v1/objects/client.jar'
    ])
    expect(progress[0]).toEqual(['download', 0, fake.jar.byteLength])
    expect(progress.at(-1)).toEqual(['download', fake.jar.byteLength, fake.jar.byteLength])
    expect(progress.every(([phase]) => phase === 'download')).toBe(true)
  })

  it('rejects a checksum mismatch and removes the partial file', async () => {
    fake.advertisedSha1 = '0'.repeat(40)
    const dest = join(dir, 'jars', '26.3.jar')
    await expect(client().downloadClientJar('26.3', dest)).rejects.toMatchObject({
      code: 'vanilla.checksumMismatch',
      params: { version: '26.3' }
    })
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('reports an unknown version', async () => {
    await expect(client().downloadClientJar('1.0', join(dir, 'x.jar'))).rejects.toMatchObject({
      code: 'vanilla.versionUnknown',
      params: { version: '1.0' }
    })
  })

  it('maps HTTP and network failures to vanilla.downloadFailed', async () => {
    fake.failJar = true
    const dest = join(dir, 'jars', '26.3.jar')
    await expect(client().downloadClientJar('26.3', dest)).rejects.toMatchObject({
      code: 'vanilla.downloadFailed'
    })
    expect(existsSync(`${dest}.part`)).toBe(false)

    await expect(client().downloadClientJar('26.2', dest)).rejects.toMatchObject({
      code: 'vanilla.downloadFailed'
    })

    const offline = createMojangClient({
      fetch: () => Promise.reject(new Error('ENOTFOUND')),
      manifestUrl: 'https://piston-meta.invalid/manifest.json'
    })
    await expect(offline.downloadClientJar('26.3', dest)).rejects.toMatchObject({
      code: 'vanilla.downloadFailed',
      params: { version: '26.3', reason: 'ENOTFOUND' }
    })
  })
})
