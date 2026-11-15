import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '../packs/files'
import { sha256 } from '../packs/paths'
import { readOptional } from './pack-files'

const BLOB_NAME = /^([0-9a-f]{64})\.bin$/

/** Content-addressed store of file versions: `<dir>/<sha256>.bin`. */
export class BlobStore {
  constructor(readonly dir: string) {}

  private file(hash: string): string {
    return join(this.dir, `${hash}.bin`)
  }

  /** Stores `data` (no-op when a blob with the same hash exists) and returns its sha256. */
  async put(data: Uint8Array): Promise<string> {
    const hash = sha256(data)
    const existing = await readOptional(this.file(hash))
    if (!existing || sha256(existing) !== hash) await writeFileAtomic(this.file(hash), data)
    return hash
  }

  /** Content of a blob, or null when missing or corrupted (hash mismatch). */
  async get(hash: string): Promise<Uint8Array | null> {
    const data = await readOptional(this.file(hash))
    return data && sha256(data) === hash ? data : null
  }

  /** Deletes every blob not in `referenced` (also cleans blobs left behind by an interrupted write). */
  async gc(referenced: ReadonlySet<string>): Promise<number> {
    let names: string[]
    try {
      names = await fs.readdir(this.dir)
    } catch {
      return 0
    }
    let removed = 0
    for (const name of names) {
      const match = BLOB_NAME.exec(name)
      if (match && referenced.has(match[1])) continue
      if (!match && !name.endsWith('.tmp')) continue
      await fs.rm(join(this.dir, name), { force: true })
      removed++
    }
    return removed
  }
}
