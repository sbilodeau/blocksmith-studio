import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '../packs/files'
import { isHiddenPath, isUnsafeArchivePath } from '../packs/paths'

export const JOURNAL_FILE = 'journal.jsonl'
export const STATE_FILE = 'state.json'

const Hash = z.string().regex(/^[0-9a-f]{64}$/)
const SafePath = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !isUnsafeArchivePath(p) && !p.endsWith('/') && !isHiddenPath(p))

/** One line of journal.jsonl. `before` / `after` are blob hashes, null when the file is absent. */
export const StoredEntrySchema = z.object({
  v: z.literal(1),
  id: z.string().min(1).max(64),
  at: z.string(),
  source: z.enum(['editor', 'revert', 'ai', 'bulk', 'import', 'merge']),
  label: z.object({
    key: z.string().min(1).max(128),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional()
  }),
  changes: z
    .array(z.object({ path: SafePath, before: Hash.nullable(), after: Hash.nullable() }))
    .min(1)
})
export type StoredEntry = z.infer<typeof StoredEntrySchema>

const StateSchema = z.object({
  schemaVersion: z.literal(1),
  /** Id of the newest applied entry; null when every entry is undone. */
  head: z.string().nullable()
})

function parseLine(line: string): StoredEntry | null {
  try {
    const parsed = StoredEntrySchema.safeParse(JSON.parse(line))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export interface JournalSnapshot {
  /** Oldest first. */
  entries: StoredEntry[]
  /** Index of the newest applied entry in `entries`; -1 when nothing is applied. */
  headIndex: number
}

export type Warn = (message: string) => void

/**
 * Persisted journal of one pack, in `<pack>/.blocksmith/history/`:
 * - `journal.jsonl`: one entry per line, oldest first. New entries are appended; the file is rewritten
 *   atomically only to drop the redo tail or trim old entries.
 * - `state.json`: `{ schemaVersion: 1, head }`, the id of the newest applied entry (undo pointer).
 *   Missing or unknown head means every entry is applied.
 */
export class Journal {
  constructor(
    readonly dir: string,
    private readonly warn: Warn
  ) {}

  private get journalFile(): string {
    return join(this.dir, JOURNAL_FILE)
  }

  private get stateFile(): string {
    return join(this.dir, STATE_FILE)
  }

  /** Reads entries and the undo pointer. Corrupted lines and duplicate ids are skipped with a warning. */
  async load(): Promise<JournalSnapshot & { endsWithNewline: boolean }> {
    let text = ''
    try {
      text = await fs.readFile(this.journalFile, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    const entries: StoredEntry[] = []
    const ids = new Set<string>()
    text.split('\n').forEach((line, i) => {
      if (line.trim() === '') return
      const entry = parseLine(line)
      if (!entry || ids.has(entry.id)) {
        this.warn(`[history] skipping corrupted journal line ${i + 1} in ${this.journalFile}`)
        return
      }
      ids.add(entry.id)
      entries.push(entry)
    })
    const head = await this.readHead()
    let headIndex = entries.length - 1
    if (head === null) headIndex = -1
    else if (head !== undefined) {
      const found = entries.findIndex((e) => e.id === head)
      if (found >= 0) headIndex = found
      else this.warn(`[history] unknown head ${head} in ${this.stateFile}, assuming all applied`)
    }
    return { entries, headIndex, endsWithNewline: text === '' || text.endsWith('\n') }
  }

  /** Head id from state.json; undefined when missing or invalid. */
  private async readHead(): Promise<string | null | undefined> {
    let raw: string
    try {
      raw = await fs.readFile(this.stateFile, 'utf8')
    } catch {
      return undefined
    }
    try {
      const parsed = StateSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data.head
    } catch {
      // fall through
    }
    this.warn(`[history] ignoring invalid ${this.stateFile}`)
    return undefined
  }

  /** Appends one entry (adds a newline first when the file ends with a partial line). */
  async append(entry: StoredEntry, endsWithNewline: boolean): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const line = `${endsWithNewline ? '' : '\n'}${JSON.stringify(entry)}\n`
    await fs.appendFile(this.journalFile, line, 'utf8')
  }

  /** Replaces the whole journal atomically. */
  async rewrite(entries: readonly StoredEntry[]): Promise<void> {
    await writeFileAtomic(this.journalFile, entries.map((e) => `${JSON.stringify(e)}\n`).join(''))
  }

  async writeHead(head: string | null): Promise<void> {
    await writeFileAtomic(this.stateFile, `${JSON.stringify({ schemaVersion: 1, head })}\n`)
  }
}
