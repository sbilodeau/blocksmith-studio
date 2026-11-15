import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { AppErrorException } from '../ipc/registry'

/** Subset of Electron's `safeStorage` (injected so tests can fake it). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface SecretsLogger {
  warn(message?: unknown, ...rest: unknown[]): void
}

/**
 * Encrypted API key store (PLAN 3.2), one key per provider id. Keys never leave the main process:
 * callers outside the AI provider layer only ever see `has()`.
 */
export interface SecretsStore {
  has(providerId: string): Promise<boolean>
  /** Decrypted key, or undefined when none is stored. Throws 'ai.secretsUnavailable' when it cannot be decrypted. */
  get(providerId: string): Promise<string | undefined>
  /** Stores the key encrypted. An empty (or blank) key deletes it. Throws 'ai.secretsUnavailable' without encryption. */
  set(providerId: string, key: string): Promise<void>
  delete(providerId: string): Promise<void>
}

export interface SecretsStoreDeps {
  /** Absolute path of the store, usually `userData/secrets.bin`. */
  filePath: string
  safeStorage: SafeStorageLike
  logger?: SecretsLogger
}

export const SECRETS_FILE_NAME = 'secrets.bin'

export function secretsFilePath(userDataDir: string): string {
  return join(userDataDir, SECRETS_FILE_NAME)
}

/**
 * File format: JSON object `{ [providerId]: base64(safeStorage ciphertext) }`. Writes are atomic (tmp + rename,
 * mode 0600) and serialized. There is no plain-text fallback: without OS encryption, storing is refused.
 */
export function createSecretsStore({
  filePath,
  safeStorage,
  logger = console
}: SecretsStoreDeps): SecretsStore {
  let entries: Map<string, string> | null = null
  let loading: Promise<Map<string, string>> | null = null
  let writeQueue: Promise<void> = Promise.resolve()

  async function readFile(): Promise<Map<string, string>> {
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
      throw err
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape')
      const map = new Map<string, string>()
      for (const [id, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && value.length > 0) map.set(id, value)
      }
      return map
    } catch {
      // Keep the unreadable file for inspection; never log its content.
      logger.warn('[secrets] unreadable secrets file, starting empty (kept as .bak)')
      await fs.copyFile(filePath, `${filePath}.bak`).catch(() => undefined)
      return new Map()
    }
  }

  async function load(): Promise<Map<string, string>> {
    if (entries) return entries
    loading ??= readFile().then((map) => {
      entries = map
      return map
    })
    return loading
  }

  async function persist(map: Map<string, string>): Promise<void> {
    const snapshot = JSON.stringify(Object.fromEntries(map))
    writeQueue = writeQueue.then(async () => {
      await fs.mkdir(dirname(filePath), { recursive: true })
      const tmp = `${filePath}.tmp`
      await fs.writeFile(tmp, snapshot, { encoding: 'utf8', mode: 0o600 })
      await fs.rename(tmp, filePath)
    })
    await writeQueue
  }

  async function remove(providerId: string): Promise<void> {
    const map = await load()
    if (!map.has(providerId)) return
    map.delete(providerId)
    await persist(map)
  }

  return {
    async has(providerId) {
      return (await load()).has(providerId)
    },

    async get(providerId) {
      const cipher = (await load()).get(providerId)
      if (cipher === undefined) return undefined
      if (!safeStorage.isEncryptionAvailable()) throw new AppErrorException('ai.secretsUnavailable')
      try {
        return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
      } catch {
        logger.warn(`[secrets] could not decrypt the key of provider ${providerId}`)
        throw new AppErrorException('ai.secretsUnavailable')
      }
    },

    async set(providerId, key) {
      const trimmed = key.trim()
      if (trimmed === '') return remove(providerId)
      if (!safeStorage.isEncryptionAvailable()) throw new AppErrorException('ai.secretsUnavailable')
      let cipher: Buffer
      try {
        cipher = safeStorage.encryptString(trimmed)
      } catch {
        throw new AppErrorException('ai.secretsUnavailable')
      }
      const map = await load()
      map.set(providerId, cipher.toString('base64'))
      await persist(map)
    },

    delete: remove
  }
}
