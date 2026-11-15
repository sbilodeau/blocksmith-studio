import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StyleBriefPatchSchema, emptyBrief } from '@shared/model/brief'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createBriefService, applyBriefPatch, appendRequestLog, REQUEST_LOG_MAX, DECISIONS_MAX } =
  await import('../../src/main/services/brief')

const AT = '2026-11-15T10:00:00.000Z'

describe('style brief patch helpers', () => {
  it('the patch schema leaves absent fields absent', () => {
    expect(StyleBriefPatchSchema.parse({ theme: 'x' })).toEqual({ theme: 'x' })
  })

  it('applies theme, palette, rules and decisions', () => {
    const base = { ...emptyBrief(), rules: ['keep'], palette: [{ hex: '#000000' }] }
    const next = applyBriefPatch(base, { theme: 'Dark', addDecision: 'Go dark' }, 'editor', AT)
    expect(next.theme).toBe('Dark')
    expect(next.rules).toEqual(['keep'])
    expect(next.palette).toEqual([{ hex: '#000000' }])
    expect(next.decisions).toEqual([{ at: AT, by: 'editor', text: 'Go dark' }])
    const replaced = applyBriefPatch(next, { rules: ['a', 'b'], palette: [] }, 'user', AT)
    expect(replaced.rules).toEqual(['a', 'b'])
    expect(replaced.palette).toEqual([])
    expect(base.rules).toEqual(['keep'])
  })

  it('caps the request log and decisions', () => {
    let brief = emptyBrief()
    for (let i = 0; i < 45; i++) brief = appendRequestLog(brief, 'editor', `req ${i}`, AT)
    expect(brief.requestLog).toHaveLength(REQUEST_LOG_MAX)
    expect(brief.requestLog[0].summary).toBe('req 15')
    for (let i = 0; i < 120; i++)
      brief = applyBriefPatch(brief, { addDecision: `d${i}` }, 'user', AT)
    expect(brief.decisions).toHaveLength(DECISIONS_MAX)
    expect(brief.decisions.at(-1)!.text).toBe('d119')
  })

  it('clips long summaries to the schema limit', () => {
    const brief = appendRequestLog(emptyBrief(), 'editor', 'x'.repeat(500), AT)
    expect(brief.requestLog[0].summary).toHaveLength(300)
  })
})

describe('brief service', () => {
  let root: string
  let folder: string
  const file = (): string => join(folder, '.blocksmith', 'style-brief.json')
  const service = (): ReturnType<typeof createBriefService> =>
    createBriefService({
      locate: async (id) => (id === 'p1' ? { folder } : null),
      now: () => new Date(AT)
    })

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bs-brief-'))
    folder = join(root, 'pack')
    await mkdir(folder, { recursive: true })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('returns the empty brief when the file is missing', async () => {
    expect(await service().get('p1')).toEqual(emptyBrief())
  })

  it('throws packs.notFound for unknown packs', async () => {
    await expect(service().get('nope')).rejects.toMatchObject({ code: 'packs.notFound' })
  })

  it('backs up an invalid file and returns the empty brief', async () => {
    await mkdir(join(folder, '.blocksmith'), { recursive: true })
    await writeFile(file(), '{"theme": 42')
    expect(await service().get('p1')).toEqual(emptyBrief())
    expect(await readFile(`${file()}.bak`, 'utf8')).toBe('{"theme": 42')
    await writeFile(file(), JSON.stringify({ palette: [{ hex: 'red' }] }))
    expect(await service().get('p1')).toEqual(emptyBrief())
  })

  it('updates with user decisions and persists atomically', async () => {
    const s = service()
    const out = await s.update('p1', { theme: 'Cozy', addDecision: 'Warm colors' })
    expect(out.theme).toBe('Cozy')
    expect(out.decisions).toEqual([{ at: AT, by: 'user', text: 'Warm colors' }])
    expect(out.updatedAt).toBe(AT)
    const onDisk = JSON.parse(await readFile(file(), 'utf8'))
    expect(onDisk.theme).toBe('Cozy')
    expect(await s.get('p1')).toEqual(out)
  })

  it('serializes concurrent changes', async () => {
    const s = service()
    await Promise.all([
      s.update('p1', { addDecision: 'one' }),
      s.update('p1', { addDecision: 'two' }),
      s.change('p1', { by: 'editor', requestLog: { agent: 'editor', summary: 'did it' } })
    ])
    const brief = await s.get('p1')
    expect(brief.decisions.map((d) => d.text)).toEqual(['one', 'two'])
    expect(brief.requestLog).toEqual([{ at: AT, agent: 'editor', summary: 'did it' }])
  })

  it('change applies patches, a decision and a request log entry in one write', async () => {
    const out = await service().change('p1', {
      patches: [{ theme: 'A' }, { rules: ['r1'] }],
      by: 'editor',
      decision: 'Style brief change approved',
      requestLog: { agent: 'editor', summary: 'stone.png: rotate' }
    })
    expect(out.theme).toBe('A')
    expect(out.rules).toEqual(['r1'])
    expect(out.decisions).toEqual([{ at: AT, by: 'editor', text: 'Style brief change approved' }])
    expect(out.requestLog).toHaveLength(1)
  })
})
