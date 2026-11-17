/**
 * Main-process timings on a synthetic huge pack (docs/performance.md). Skipped unless BLOCKSMITH_PERF is set:
 *
 *   BLOCKSMITH_PERF=1 npx vitest run --project perf
 *
 * Options (environment): BLOCKSMITH_PERF_SMALL (16x16 textures, default 10000), BLOCKSMITH_PERF_LARGE (512x512,
 * default 2000), BLOCKSMITH_PERF_ANIMATED (of the large ones, 512x4096 strips, default 50),
 * BLOCKSMITH_PERF_WORKSPACE (reuse a workspace made by scripts/make-big-pack.mjs instead of a new temp one).
 * Prints a table; there are no timing assertions (machines differ).
 */
import { mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createPackService, type PackService } from '../../src/main/services/packs'
import { FakeVanillaStore } from '../integration/packs-fixtures'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const env = process.env
const enabled = !!env['BLOCKSMITH_PERF']

interface BigPack {
  folder: string
  packId: string
  files: number
  bytes: number
}

type MakeBigPack = (dir: string, options: Record<string, number>) => Promise<BigPack>

function service(workspace: string, root: string): PackService {
  return createPackService({
    vanilla: new FakeVanillaStore(join(root, 'vanilla')),
    jobs: { start: () => () => undefined },
    documentsDir: root,
    getWorkspacePath: () => workspace,
    setWorkspacePath: () => undefined,
    trashItem: async () => undefined,
    showItemInFolder: () => undefined,
    notifyChanged: () => undefined
  })
}

/** Runs `fn` and returns its duration and the longest event-loop block seen meanwhile (main-process stalls). */
async function timeWithLag<T>(fn: () => Promise<T>): Promise<[number, number, T]> {
  let worst = 0
  let last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    worst = Math.max(worst, now - last - 5)
    last = now
  }, 5)
  try {
    const [ms, value] = await time(fn)
    return [ms, worst, value]
  } finally {
    clearInterval(timer)
  }
}

async function time<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const start = performance.now()
  const value = await fn()
  return [performance.now() - start, value]
}

describe.skipIf(!enabled)('huge pack timings (main process)', () => {
  let root: string
  let workspace: string
  let pack: BigPack
  const rows: Array<[string, number]> = []

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'blocksmith-perf-'))
    workspace = env['BLOCKSMITH_PERF_WORKSPACE'] ?? join(root, 'workspace')
    const mod = (await import('../../scripts/make-big-pack.mjs' as string)) as {
      makeBigPack: MakeBigPack
    }
    const [ms, made] = await time(() =>
      mod.makeBigPack(workspace, {
        small: Number(env['BLOCKSMITH_PERF_SMALL'] ?? 10_000),
        large: Number(env['BLOCKSMITH_PERF_LARGE'] ?? 2_000),
        animated: Number(env['BLOCKSMITH_PERF_ANIMATED'] ?? 50)
      })
    )
    pack = made
    console.info(
      `generated ${pack.files} files (${(pack.bytes / 2 ** 20).toFixed(0)} MiB) in ${ms.toFixed(0)} ms`
    )
  }, 600_000)

  afterAll(async () => {
    console.info(
      [
        '| Operation | ms |',
        '| --- | ---: |',
        ...rows.map(([k, v]) => `| ${k} | ${v.toFixed(0)} |`)
      ].join('\n')
    )
    await rm(root, { recursive: true, force: true })
  })

  it('measures the texture index, categories, doctor and export', async () => {
    // Cold: a fresh service (empty file info cache), as after an app start.
    const cold = service(workspace, root)
    const [listMs] = await time(() => cold.list())
    rows.push(['packs.list, cold (home screen after start)', listMs])

    const fresh = service(workspace, root)
    const [texColdMs, texLag, entries] = await timeWithLag(() => fresh.textures(pack.packId))
    expect(entries.length).toBeGreaterThan(0)
    rows.push([`pack.textures, cold (${entries.length} textures)`, texColdMs])
    rows.push(['pack.textures, cold: longest event-loop block', texLag])

    // What a pack tab does on open: pack.get + pack.textures + pack.categories in parallel.
    const tab = service(workspace, root)
    const [tabColdMs] = await time(() =>
      Promise.all([tab.get(pack.packId), tab.textures(pack.packId), tab.categories(pack.packId)])
    )
    rows.push(['tab load (get + textures + categories), cold', tabColdMs])
    const [tabWarmMs] = await time(() =>
      Promise.all([tab.get(pack.packId), tab.textures(pack.packId), tab.categories(pack.packId)])
    )
    rows.push(['tab load (get + textures + categories), warm', tabWarmMs])

    const [texWarmMs] = await time(() => fresh.textures(pack.packId))
    rows.push(['pack.textures, warm', texWarmMs])
    const [catWarmMs] = await time(() => fresh.categories(pack.packId))
    rows.push(['pack.categories, warm', catWarmMs])

    // One file touched (an editor save): rescan + re-hash of that file only.
    const one = entries.find((e) => e.width >= 256) ?? entries[0]
    const abs = join(pack.folder, ...one.path.split('/'))
    const later = new Date(Date.now() + 10_000)
    await utimes(abs, later, later)
    const [touchedMs] = await time(() => fresh.textures(pack.packId))
    rows.push(['pack.textures, one file changed', touchedMs])

    // IPC serialization of the list (Electron uses the structured clone algorithm).
    const [cloneMs] = await time(async () => structuredClone(entries))
    rows.push(['structured clone of the texture list (IPC)', cloneMs])

    const [doctorMs, doctorLag] = await timeWithLag(() => fresh.doctor(pack.packId))
    rows.push(['pack.doctor', doctorMs])
    rows.push(['pack.doctor: longest event-loop block', doctorLag])

    const out = join(root, 'export.zip')
    const [exportMs, exportLag] = await timeWithLag(() =>
      fresh.exportPack(pack.packId, '26.3', out)
    )
    rows.push(['pack.export (26.3)', exportMs])
    rows.push(['pack.export: longest event-loop block', exportLag])
    const rss = process.memoryUsage().rss
    rows.push(['process RSS after export (MiB)', rss / 2 ** 20])
  }, 600_000)
})
