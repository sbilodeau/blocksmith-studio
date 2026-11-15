import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PackLocation } from '../../src/main/services/packs'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createHistoryService } = await import('../../src/main/services/history')
type HistoryService = ReturnType<typeof createHistoryService>

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const hash = (s: string): string => createHash('sha256').update(s).digest('hex')
const A = 'assets/minecraft/textures/block/a.png'
const B = 'assets/minecraft/textures/block/b.png'
const label = { key: 'save', params: { name: 'a' } }

describe('history journal', () => {
  let root: string
  let folder: string
  let historyDir: string
  let history: HistoryService
  let notifyChanged: Mock<(packId: string) => void>
  let onFilesChanged: Mock<(location: PackLocation, paths: readonly string[]) => void>
  let warn: Mock<(message: string) => void>
  let location: PackLocation

  function create(maxEntries?: number): HistoryService {
    let n = 0
    return createHistoryService({
      locate: async (id) => (id === 'p1' ? location : null),
      notifyChanged,
      onFilesChanged,
      warn,
      maxEntries,
      newId: () => `e${++n}`,
      now: () => new Date(Date.UTC(2026, 10, 15, 10, 0, n))
    })
  }

  const file = (path: string): string => join(folder, ...path.split('/'))
  const read = (path: string): Promise<string | null> =>
    readFile(file(path), 'utf8').catch(() => null)
  async function write(path: string, text: string): Promise<void> {
    await mkdir(join(file(path), '..'), { recursive: true })
    await writeFile(file(path), text)
  }
  const blobs = async (): Promise<string[]> =>
    (await readdir(join(historyDir, 'blobs')).catch(() => [])).sort()
  const save = (path: string, text: string | null): ReturnType<HistoryService['apply']> =>
    history.apply('p1', {
      source: 'editor',
      label,
      changes: [{ path, after: text === null ? null : enc(text) }]
    })

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'blocksmith-history-'))
    folder = join(root, 'pack')
    historyDir = join(folder, '.blocksmith', 'history')
    await mkdir(folder, { recursive: true })
    location = { id: 'p1', folder, project: {} as PackLocation['project'] }
    notifyChanged = vi.fn()
    onFilesChanged = vi.fn()
    warn = vi.fn()
    history = create()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('starts empty', async () => {
    await expect(history.get('p1')).resolves.toEqual({
      entries: [],
      canUndo: false,
      canRedo: false
    })
  })

  it('apply writes the file, stores blobs and appends a journal line', async () => {
    const entry = await save(A, 'v1')
    expect(entry).toEqual({
      id: 'e1',
      at: '2026-11-15T10:00:01.000Z',
      source: 'editor',
      label,
      paths: [A],
      applied: true
    })
    expect(await read(A)).toBe('v1')
    expect(onFilesChanged).toHaveBeenCalledWith(location, [A])
    expect(await blobs()).toEqual([`${hash('v1')}.bin`])
    const lines = (await readFile(join(historyDir, 'journal.jsonl'), 'utf8')).trim().split('\n')
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      {
        v: 1,
        id: 'e1',
        at: entry.at,
        source: 'editor',
        label,
        changes: [{ path: A, before: null, after: hash('v1') }]
      }
    ])
    expect(JSON.parse(await readFile(join(historyDir, 'state.json'), 'utf8'))).toEqual({
      schemaVersion: 1,
      head: 'e1'
    })
  })

  it('record stores a change made by the caller without touching files', async () => {
    const entry = await history.record('p1', {
      source: 'ai',
      label: { key: 'ai' },
      changes: [
        { path: A, before: enc('old'), after: enc('new') },
        { path: B, before: null, after: enc('b') }
      ]
    })
    expect(entry.paths).toEqual([A, B])
    expect(await read(A)).toBeNull()
    expect(await blobs()).toHaveLength(3)
    await expect(
      history.record('p1', {
        source: 'ai',
        label: { key: 'ai' },
        changes: [{ path: '../evil.png', before: null, after: enc('x') }]
      })
    ).rejects.toMatchObject({ code: 'history.invalidPath' })
    await expect(
      history.record('p1', {
        source: 'ai',
        label: { key: 'ai' },
        changes: [{ path: '.blocksmith/project.json', before: null, after: enc('x') }]
      })
    ).rejects.toMatchObject({ code: 'history.invalidPath' })
  })

  it('undo and redo move files between before and after states', async () => {
    await write(A, 'v0')
    await save(A, 'v1')
    await save(A, 'v2')
    await save(B, 'b1')

    let state = await history.undo('p1')
    expect(await read(B)).toBeNull()
    expect(state.canUndo).toBe(true)
    expect(state.canRedo).toBe(true)
    expect(state.entries.map((e) => [e.id, e.applied])).toEqual([
      ['e3', false],
      ['e2', true],
      ['e1', true]
    ])
    expect(notifyChanged).toHaveBeenLastCalledWith('p1')
    expect(onFilesChanged).toHaveBeenLastCalledWith(location, [B])

    await history.undo('p1')
    expect(await read(A)).toBe('v1')
    state = await history.undo('p1')
    expect(await read(A)).toBe('v0')
    expect(state.canUndo).toBe(false)
    // Nothing left: undo is a no-op.
    notifyChanged.mockClear()
    await expect(history.undo('p1')).resolves.toEqual(state)
    expect(notifyChanged).not.toHaveBeenCalled()

    await history.redo('p1')
    expect(await read(A)).toBe('v1')
    await history.redo('p1')
    state = await history.redo('p1')
    expect(await read(A)).toBe('v2')
    expect(await read(B)).toBe('b1')
    expect(state.canRedo).toBe(false)
    await expect(history.redo('p1')).resolves.toEqual(state)
  })

  it('undo and redo state survives a new service instance (persisted pointer)', async () => {
    await save(A, 'v1')
    await save(A, 'v2')
    await history.undo('p1')
    const fresh = create()
    const state = await fresh.get('p1')
    expect(state.entries.map((e) => e.applied)).toEqual([false, true])
    await fresh.redo('p1')
    expect(await read(A)).toBe('v2')
  })

  it('recording after undos discards the redo tail and its unreferenced blobs', async () => {
    await save(A, 'v1')
    await save(A, 'v2')
    await save(A, 'v3')
    await history.undo('p1')
    await history.undo('p1')
    expect(await blobs()).toHaveLength(3)

    await save(A, 'w2')
    const state = await history.get('p1')
    expect(state.entries.map((e) => e.id)).toEqual(['e4', 'e1'])
    expect(state.canRedo).toBe(false)
    expect(await blobs()).toEqual([`${hash('v1')}.bin`, `${hash('w2')}.bin`].sort())
    await history.undo('p1')
    expect(await read(A)).toBe('v1')
  })

  it('keeps at most maxEntries and garbage-collects blobs of trimmed entries', async () => {
    history = create(3)
    for (let i = 1; i <= 5; i++) await save(A, `v${i}`)
    const state = await history.get('p1')
    expect(state.entries.map((e) => e.id)).toEqual(['e5', 'e4', 'e3'])
    // e3 restores v2, so v2..v5 stay referenced.
    expect(await blobs()).toEqual(['v2', 'v3', 'v4', 'v5'].map((v) => `${hash(v)}.bin`).sort())
    await history.undo('p1')
    await history.undo('p1')
    await history.undo('p1')
    expect(await read(A)).toBe('v2')
    expect((await history.get('p1')).canUndo).toBe(false)
  })

  it('skips corrupted journal lines with a warning and keeps appending on a new line', async () => {
    await save(A, 'v1')
    const journal = join(historyDir, 'journal.jsonl')
    await appendFile(journal, 'not json\n{"v":1,"id":"x"}\n{"v":1,"id":"partial"')
    const state = await history.get('p1')
    expect(state.entries.map((e) => e.id)).toEqual(['e1'])
    expect(warn).toHaveBeenCalledTimes(3)

    await save(A, 'v2')
    expect((await history.get('p1')).entries.map((e) => e.id)).toEqual(['e2', 'e1'])
    await history.undo('p1')
    expect(await read(A)).toBe('v1')
  })

  it('treats a missing or invalid state file as "everything applied"', async () => {
    await save(A, 'v1')
    await writeFile(join(historyDir, 'state.json'), '{oops')
    expect((await history.get('p1')).canUndo).toBe(true)
    await rm(join(historyDir, 'state.json'))
    expect((await history.get('p1')).entries[0].applied).toBe(true)
  })

  it('refuses to undo or redo over a file changed outside the app', async () => {
    await save(A, 'v1')
    await write(A, 'edited outside')
    await expect(history.undo('p1')).rejects.toMatchObject({
      code: 'history.conflict',
      params: { path: A }
    })
    expect(await read(A)).toBe('edited outside')
    expect((await history.get('p1')).canUndo).toBe(true)

    await write(A, 'v1')
    await history.undo('p1')
    await write(A, 'created outside')
    await expect(history.redo('p1')).rejects.toMatchObject({ code: 'history.conflict' })
    expect(await read(A)).toBe('created outside')
  })

  it('checks every path before writing anything (multi-file entries)', async () => {
    await history.apply('p1', {
      source: 'ai',
      label: { key: 'ai' },
      changes: [
        { path: A, after: enc('a1') },
        { path: B, after: enc('b1') }
      ]
    })
    await write(B, 'edited')
    await expect(history.undo('p1')).rejects.toMatchObject({ code: 'history.conflict' })
    expect(await read(A)).toBe('a1')
  })

  it('accepts a file already in the target state (resumes an interrupted undo)', async () => {
    await write(A, 'v0')
    await save(A, 'v1')
    await write(A, 'v0')
    await history.undo('p1')
    expect((await history.get('p1')).canUndo).toBe(false)
  })

  it('reports a missing blob instead of writing garbage', async () => {
    await write(A, 'v0')
    await save(A, 'v1')
    await rm(join(historyDir, 'blobs', `${hash('v0')}.bin`))
    await expect(history.undo('p1')).rejects.toMatchObject({ code: 'history.blobMissing' })
    expect(await read(A)).toBe('v1')
  })

  it('serializes concurrent operations on a pack', async () => {
    await Promise.all([save(A, 'v1'), save(A, 'v2'), save(A, 'v3')])
    const state = await history.get('p1')
    expect(state.entries.map((e) => e.id)).toEqual(['e3', 'e2', 'e1'])
    const [, , last] = await Promise.all([
      history.undo('p1'),
      history.undo('p1'),
      history.redo('p1')
    ])
    expect(last.entries.map((e) => e.applied)).toEqual([false, true, true])
    expect(await read(A)).toBe('v2')
  })

  it('rejects unknown packs', async () => {
    await expect(history.get('nope')).rejects.toMatchObject({ code: 'packs.notFound' })
    await expect(history.undo('nope')).rejects.toMatchObject({ code: 'packs.notFound' })
  })
})
