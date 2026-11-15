import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createSecretsStore, secretsFilePath } = await import('../../src/main/services/secrets')
const { AppErrorException } = await import('../../src/main/ipc/registry')

/** Reversible fake "encryption" (XOR + marker) so the file never holds the plain key. */
function fakeSafeStorage(available = true): {
  isEncryptionAvailable: () => boolean
  encryptString: (s: string) => Buffer
  decryptString: (b: Buffer) => string
  available: boolean
} {
  const store = {
    available,
    isEncryptionAvailable: () => store.available,
    encryptString: (s: string) =>
      Buffer.concat([Buffer.from('ENC:'), Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)]),
    decryptString: (b: Buffer) => {
      if (b.subarray(0, 4).toString() !== 'ENC:') throw new Error('bad ciphertext')
      return Buffer.from(b.subarray(4).map((x) => x ^ 0x5a)).toString('utf8')
    }
  }
  return store
}

const KEY = 'sk-test-0123456789abcdef'

describe('SecretsStore', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blocksmith-secrets-'))
    file = secretsFilePath(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips a key and persists only ciphertext', async () => {
    const safeStorage = fakeSafeStorage()
    const store = createSecretsStore({ filePath: file, safeStorage })
    expect(await store.has('ollama-cloud')).toBe(false)
    await store.set('ollama-cloud', `  ${KEY}\n`)
    expect(await store.has('ollama-cloud')).toBe(true)
    expect(await store.get('ollama-cloud')).toBe(KEY)

    const raw = await readFile(file, 'utf8')
    expect(raw).not.toContain(KEY)
    const json = JSON.parse(raw)
    expect(Object.keys(json)).toEqual(['ollama-cloud'])
    expect(Buffer.from(json['ollama-cloud'], 'base64').subarray(0, 4).toString()).toBe('ENC:')
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)

    const reloaded = createSecretsStore({ filePath: file, safeStorage })
    expect(await reloaded.get('ollama-cloud')).toBe(KEY)
  })

  it('refuses to store when encryption is unavailable (no plain-text fallback)', async () => {
    const store = createSecretsStore({ filePath: file, safeStorage: fakeSafeStorage(false) })
    await expect(store.set('ollama-cloud', KEY)).rejects.toMatchObject({
      code: 'ai.secretsUnavailable'
    })
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('error messages never contain the key', async () => {
    const safeStorage = fakeSafeStorage()
    safeStorage.encryptString = () => {
      throw new Error(`failed for ${KEY}`)
    }
    const store = createSecretsStore({ filePath: file, safeStorage })
    const err = await store.set('p', KEY).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppErrorException)
    expect(
      JSON.stringify({
        m: (err as Error).message,
        p: (err as InstanceType<typeof AppErrorException>).params
      })
    ).not.toContain(KEY)
  })

  it('empty key and delete remove the entry', async () => {
    const store = createSecretsStore({ filePath: file, safeStorage: fakeSafeStorage() })
    await store.set('a', 'key-a')
    await store.set('b', 'key-b')
    await store.set('a', '')
    expect(await store.has('a')).toBe(false)
    await store.delete('b')
    expect(await store.has('b')).toBe(false)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({})
    // Deleting a missing key is a no-op, even without encryption.
    const noEnc = createSecretsStore({ filePath: file, safeStorage: fakeSafeStorage(false) })
    await expect(noEnc.delete('zzz')).resolves.toBeUndefined()
  })

  it('reports undecryptable keys as unavailable without leaking anything', async () => {
    await writeFile(file, JSON.stringify({ p: Buffer.from('garbage').toString('base64') }))
    const warn = vi.fn()
    const store = createSecretsStore({
      filePath: file,
      safeStorage: fakeSafeStorage(),
      logger: { warn }
    })
    await expect(store.get('p')).rejects.toMatchObject({ code: 'ai.secretsUnavailable' })
  })

  it('starts empty from a corrupted file and keeps a backup', async () => {
    await writeFile(file, '{not json')
    const warn = vi.fn()
    const store = createSecretsStore({
      filePath: file,
      safeStorage: fakeSafeStorage(),
      logger: { warn }
    })
    expect(await store.has('x')).toBe(false)
    expect(await readFile(`${file}.bak`, 'utf8')).toBe('{not json')
    expect(warn).toHaveBeenCalled()
  })
})
