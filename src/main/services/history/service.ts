import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { HistoryEntry, HistoryState } from '@shared/model/history'
import { AppErrorException } from '../../ipc/registry'
import { sha256 } from '../packs/paths'
import { META_DIR, type PackLocation } from '../packs/project'
import { BlobStore } from './blobs'
import { Journal, type JournalSnapshot, type StoredEntry, type Warn } from './journal'
import { assertInsidePack, readOptional, resolvePackFile, writeOrDelete } from './pack-files'

/** History folder inside a pack. */
export const HISTORY_DIR = `${META_DIR}/history`
export const DEFAULT_MAX_ENTRIES = 200

/** Error codes thrown by the history service (i18n: `errors.<code>`). */
export const HistoryErrorCode = {
  /** A file was changed outside the app since the entry was applied or undone (params: path). */
  conflict: 'history.conflict',
  /** A blob needed to restore a file is missing or corrupted (params: path). */
  blobMissing: 'history.blobMissing',
  /** A change targets a path that is not a safe pack file path (params: path). */
  invalidPath: 'history.invalidPath'
} as const

export type HistorySource = HistoryEntry['source']
export type HistoryLabel = HistoryEntry['label']

/** One file of a change set: content before and after (null = file absent). */
export interface FileChange {
  /** Pack-relative POSIX path. */
  path: string
  before: Uint8Array | null
  after: Uint8Array | null
}

export interface ChangeSet<C> {
  source: HistorySource
  label: HistoryLabel
  changes: C[]
}

export interface HistoryServiceDeps {
  /** Folder of a pack, or null when unknown (PackService.locate). */
  locate: (packId: string) => Promise<PackLocation | null>
  /** Called after the service wrote or deleted pack files (PackService.invalidate). */
  onFilesChanged?: (location: PackLocation, paths: readonly string[]) => void
  /** Main forwards this as the 'packs.changed' event (called after undo / redo). */
  notifyChanged: (packId: string) => void
  /** Entries kept per pack (oldest are trimmed and their blobs collected). Default 200. */
  maxEntries?: number
  now?: () => Date
  newId?: () => string
  warn?: Warn
}

export interface HistoryService {
  get(packId: string): Promise<HistoryState>
  /**
   * Records a change the caller already made on disk (before / after contents given). Discards the redo tail.
   * Paths whose before and after are identical are kept (the entry still exists, undoing it is a no-op).
   */
  record(packId: string, change: ChangeSet<FileChange>): Promise<HistoryEntry>
  /**
   * Snapshots the current content of every path, writes the new contents (null deletes the file) and records
   * one entry, all under the pack's lock. This is the entry point for editor saves, reverts and, later,
   * AI proposals, imports and merges (multi-file entries).
   */
  apply(
    packId: string,
    change: ChangeSet<{ path: string; after: Uint8Array | null }>
  ): Promise<HistoryEntry>
  /** Restores the before state of the newest applied entry (no-op when there is none). */
  undo(packId: string): Promise<HistoryState>
  /** Re-applies the oldest undone entry (no-op when there is none). */
  redo(packId: string): Promise<HistoryState>
}

interface PackContext {
  location: PackLocation
  journal: Journal
  blobs: BlobStore
}

export function createHistoryService(deps: HistoryServiceDeps): HistoryService {
  const maxEntries = Math.max(1, deps.maxEntries ?? DEFAULT_MAX_ENTRIES)
  const now = deps.now ?? ((): Date => new Date())
  const newId = deps.newId ?? ((): string => randomUUID())
  const warn = deps.warn ?? ((message: string): void => console.warn(message))
  /** Per-pack promise queue: operations on one pack never interleave. */
  const queues = new Map<string, Promise<unknown>>()

  function serialize<T>(packId: string, fn: () => Promise<T>): Promise<T> {
    const previous = queues.get(packId) ?? Promise.resolve()
    const run = previous.then(fn, fn)
    const tail = run.catch(() => undefined)
    queues.set(packId, tail)
    void tail.then(() => {
      if (queues.get(packId) === tail) queues.delete(packId)
    })
    return run
  }

  async function context(packId: string): Promise<PackContext> {
    const location = await deps.locate(packId)
    if (!location) throw new AppErrorException('packs.notFound', { packId })
    const dir = join(location.folder, ...HISTORY_DIR.split('/'))
    return {
      location,
      journal: new Journal(dir, warn),
      blobs: new BlobStore(join(dir, 'blobs'))
    }
  }

  function packFile(location: PackLocation, path: string): string {
    const abs = resolvePackFile(location.folder, path)
    if (!abs) throw new AppErrorException(HistoryErrorCode.invalidPath, { path })
    return abs
  }

  function toState(snapshot: JournalSnapshot): HistoryState {
    const entries: HistoryEntry[] = snapshot.entries.map((e, i) => ({
      id: e.id,
      at: e.at,
      source: e.source,
      label: e.label,
      paths: e.changes.map((c) => c.path),
      applied: i <= snapshot.headIndex
    }))
    entries.reverse()
    return {
      entries,
      canUndo: snapshot.headIndex >= 0,
      canRedo: snapshot.headIndex < snapshot.entries.length - 1
    }
  }

  /** Appends an entry after the head: drops the redo tail and trims old entries, then collects blobs. */
  async function commit(ctx: PackContext, entry: StoredEntry): Promise<void> {
    const snapshot = await ctx.journal.load()
    const kept = snapshot.entries.slice(0, snapshot.headIndex + 1)
    const dropped = kept.length < snapshot.entries.length
    kept.push(entry)
    const trimmed = kept.length > maxEntries
    const entries = trimmed ? kept.slice(kept.length - maxEntries) : kept
    if (dropped || trimmed) await ctx.journal.rewrite(entries)
    else await ctx.journal.append(entry, snapshot.endsWithNewline)
    await ctx.journal.writeHead(entry.id)
    if (dropped || trimmed) {
      const referenced = new Set<string>()
      for (const e of entries) {
        for (const c of e.changes) {
          if (c.before) referenced.add(c.before)
          if (c.after) referenced.add(c.after)
        }
      }
      await ctx.blobs.gc(referenced)
    }
  }

  async function storeEntry(
    ctx: PackContext,
    change: ChangeSet<FileChange>
  ): Promise<HistoryEntry> {
    if (change.changes.length === 0) throw new Error('history: empty change set')
    const changes: StoredEntry['changes'] = []
    for (const c of change.changes) {
      packFile(ctx.location, c.path)
      changes.push({
        path: c.path,
        before: c.before ? await ctx.blobs.put(c.before) : null,
        after: c.after ? await ctx.blobs.put(c.after) : null
      })
    }
    const entry: StoredEntry = {
      v: 1,
      id: newId(),
      at: now().toISOString(),
      source: change.source,
      label: change.label,
      changes
    }
    await commit(ctx, entry)
    return {
      id: entry.id,
      at: entry.at,
      source: entry.source,
      label: entry.label,
      paths: changes.map((c) => c.path),
      applied: true
    }
  }

  /**
   * Moves files from `expected` to `target` (blob hashes, null = absent). A file already in its target state is
   * left alone (makes an interrupted undo / redo resumable); any other content is an external edit and the
   * whole operation is refused before anything is written.
   */
  async function transition(
    ctx: PackContext,
    changes: ReadonlyArray<{ path: string; expected: string | null; target: string | null }>
  ): Promise<string[]> {
    const writes: Array<{ abs: string; path: string; data: Uint8Array | null }> = []
    for (const c of changes) {
      const abs = packFile(ctx.location, c.path)
      const current = await readOptional(abs)
      const hash = current ? sha256(current) : null
      if (hash === c.target) continue
      if (hash !== c.expected) {
        throw new AppErrorException(HistoryErrorCode.conflict, { path: c.path })
      }
      let data: Uint8Array | null = null
      if (c.target) {
        data = await ctx.blobs.get(c.target)
        if (!data) throw new AppErrorException(HistoryErrorCode.blobMissing, { path: c.path })
      }
      await assertInsidePack(ctx.location.folder, abs, c.path)
      writes.push({ abs, path: c.path, data })
    }
    for (const w of writes) await writeOrDelete(w.abs, w.data)
    return changes.map((c) => c.path)
  }

  function filesChanged(location: PackLocation, paths: readonly string[]): void {
    if (paths.length > 0) deps.onFilesChanged?.(location, paths)
  }

  return {
    get(packId) {
      return serialize(packId, async () => toState(await (await context(packId)).journal.load()))
    },

    record(packId, change) {
      return serialize(packId, async () => storeEntry(await context(packId), change))
    },

    apply(packId, change) {
      return serialize(packId, async () => {
        const ctx = await context(packId)
        const files: FileChange[] = []
        const targets: string[] = []
        for (const c of change.changes) {
          const abs = packFile(ctx.location, c.path)
          await assertInsidePack(ctx.location.folder, abs, c.path)
          files.push({ path: c.path, before: await readOptional(abs), after: c.after })
          targets.push(abs)
        }
        for (let i = 0; i < files.length; i++) await writeOrDelete(targets[i], files[i].after)
        filesChanged(
          ctx.location,
          files.map((f) => f.path)
        )
        return storeEntry(ctx, { source: change.source, label: change.label, changes: files })
      })
    },

    undo(packId) {
      return serialize(packId, async () => {
        const ctx = await context(packId)
        const snapshot = await ctx.journal.load()
        if (snapshot.headIndex < 0) return toState(snapshot)
        const entry = snapshot.entries[snapshot.headIndex]
        const paths = await transition(
          ctx,
          entry.changes.map((c) => ({ path: c.path, expected: c.after, target: c.before }))
        )
        const headIndex = snapshot.headIndex - 1
        await ctx.journal.writeHead(headIndex >= 0 ? snapshot.entries[headIndex].id : null)
        filesChanged(ctx.location, paths)
        deps.notifyChanged(packId)
        return toState({ entries: snapshot.entries, headIndex })
      })
    },

    redo(packId) {
      return serialize(packId, async () => {
        const ctx = await context(packId)
        const snapshot = await ctx.journal.load()
        const headIndex = snapshot.headIndex + 1
        if (headIndex >= snapshot.entries.length) return toState(snapshot)
        const entry = snapshot.entries[headIndex]
        const paths = await transition(
          ctx,
          entry.changes.map((c) => ({ path: c.path, expected: c.before, target: c.after }))
        )
        await ctx.journal.writeHead(entry.id)
        filesChanged(ctx.location, paths)
        deps.notifyChanged(packId)
        return toState({ entries: snapshot.entries, headIndex })
      })
    }
  }
}
