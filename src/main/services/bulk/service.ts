import { randomUUID } from 'node:crypto'
import { frameHeightOf, type BulkOperation } from '@shared/bulk/operations'
import type { BulkApplyResult, BulkItem, BulkPreview } from '@shared/model/bulk'
import type { HistoryEntry } from '@shared/model/history'
import type { StyleBrief } from '@shared/model/brief'
import type { TextureEntry } from '@shared/model/pack'
import type { JobReporter } from '../contracts'
import { AppErrorException } from '../../ipc/registry'
import type { BulkItemResult } from './compute'
import type { BulkRunner } from './runner'

/** Previews are kept this long before apply (then the user previews again). */
export const BULK_PREVIEW_TTL_MS = 30 * 60 * 1000

export interface BulkServiceDeps {
  packs: { textures(packId: string): Promise<TextureEntry[]> }
  textures: {
    read(packId: string, path: string): Promise<{ png: Uint8Array | null }>
    saveMany(
      packId: string,
      items: ReadonlyArray<{ path: string; png: Uint8Array }>,
      change: { source: HistoryEntry['source']; label: HistoryEntry['label'] }
    ): Promise<HistoryEntry | null>
  }
  brief?: { get(packId: string): Promise<StyleBrief> }
  run: BulkRunner
  jobs?: JobReporter
  now?: () => number
  newId?: () => string
  ttlMs?: number
}

/** A texture with its current pixels and the operations to run on it. */
export interface BulkTarget {
  path: string
  ops: BulkOperation[]
}

export interface BulkComputed {
  /** Textures that change: before / after PNG. */
  items: BulkItem[]
  unchanged: string[]
  failed: Array<{ path: string; error: string }>
}

export interface BulkService {
  /** Computes a manual bulk action on a selection (worker thread, 'bulk.preview' progress). Nothing is written. */
  preview(packId: string, paths: string[], operations: BulkOperation[]): Promise<BulkPreview>
  /** Writes the ticked textures of a preview as one undoable history entry. */
  apply(previewId: string, paths: string[]): Promise<BulkApplyResult>
  discard(previewId: string): void
  /**
   * Runs per-texture operations on the textures' current pixels (navigation agent proposals). `before` overrides
   * the pixels of a texture (the base the agent saw).
   */
  compute(
    packId: string,
    targets: BulkTarget[],
    options?: { before?: ReadonlyMap<string, Uint8Array>; kind?: 'bulk.preview' | 'bulk.apply' }
  ): Promise<BulkComputed>
  /** Writes computed textures as one history entry. */
  write(
    packId: string,
    items: ReadonlyArray<{ path: string; png: Uint8Array }>,
    change: { source: HistoryEntry['source']; label: HistoryEntry['label'] }
  ): Promise<number>
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.png$/, '')
}

export function createBulkService(deps: BulkServiceDeps): BulkService {
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? ((): string => randomUUID())
  const ttl = deps.ttlMs ?? BULK_PREVIEW_TTL_MS
  const previews = new Map<string, { preview: BulkPreview; at: number }>()

  function expire(): void {
    for (const [id, p] of previews) if (now() - p.at > ttl) previews.delete(id)
  }

  async function compute(
    packId: string,
    targets: BulkTarget[],
    options: { before?: ReadonlyMap<string, Uint8Array>; kind?: 'bulk.preview' | 'bulk.apply' } = {}
  ): Promise<BulkComputed> {
    const entries = new Map((await deps.packs.textures(packId)).map((e) => [e.path, e]))
    const failed: BulkComputed['failed'] = []
    const items: Array<{
      path: string
      png: Uint8Array
      ops: BulkOperation[]
      frameHeight?: number
    }> = []
    for (const t of targets) {
      const entry = entries.get(t.path)
      if (!entry) {
        failed.push({ path: t.path, error: 'not a texture of this pack' })
        continue
      }
      const png = options.before?.get(t.path) ?? (await deps.textures.read(packId, t.path)).png
      if (!png) {
        failed.push({ path: t.path, error: 'texture file missing' })
        continue
      }
      const frameHeight = frameHeightOf(entry)
      items.push({ path: t.path, png, ops: t.ops, ...(frameHeight ? { frameHeight } : {}) })
    }
    const progress = deps.jobs?.start(options.kind ?? 'bulk.preview')
    const brief = deps.brief ? await deps.brief.get(packId).catch(() => undefined) : undefined
    progress?.('compute', 0, items.length)
    // Copies: a worker may transfer (detach) the buffers it receives back.
    const before = new Map(items.map((i) => [i.path, i.png.slice()]))
    const results: BulkItemResult[] = await deps.run(
      { items, ...(brief ? { brief } : {}) },
      (done, total) => progress?.('compute', done, total)
    )
    const out: BulkComputed = { items: [], unchanged: [], failed }
    for (const r of results) {
      if (r.error) out.failed.push({ path: r.path, error: r.error })
      else if (!r.png || r.changedPixels === 0) out.unchanged.push(r.path)
      else {
        out.items.push({
          path: r.path,
          name: nameOf(r.path),
          beforePng: before.get(r.path)!,
          afterPng: r.png,
          changedPixels: r.changedPixels
        })
      }
    }
    return out
  }

  async function write(
    packId: string,
    items: ReadonlyArray<{ path: string; png: Uint8Array }>,
    change: { source: HistoryEntry['source']; label: HistoryEntry['label'] }
  ): Promise<number> {
    if (items.length === 0) return 0
    const progress = deps.jobs?.start('bulk.apply')
    progress?.('write', 0, items.length)
    await deps.textures.saveMany(packId, items, change)
    progress?.('write', items.length, items.length)
    return items.length
  }

  return {
    async preview(packId, paths, operations) {
      expire()
      const unique = [...new Set(paths)]
      const computed = await compute(
        packId,
        unique.map((path) => ({ path, ops: operations }))
      )
      const preview: BulkPreview = { id: newId(), packId, operations, ...computed }
      previews.set(preview.id, { preview, at: now() })
      return preview
    },

    async apply(previewId, paths) {
      expire()
      const hit = previews.get(previewId)
      if (!hit) throw new AppErrorException('bulk.previewExpired')
      previews.delete(previewId)
      const { preview } = hit
      const keep = new Set(paths)
      const items = preview.items
        .filter((i) => keep.has(i.path))
        .map((i) => ({ path: i.path, png: i.afterPng }))
      const applied = await write(preview.packId, items, {
        source: 'bulk',
        label: { key: 'bulk', params: { count: items.length } }
      })
      return { applied }
    },

    discard(previewId) {
      previews.delete(previewId)
    },

    compute,
    write
  }
}
