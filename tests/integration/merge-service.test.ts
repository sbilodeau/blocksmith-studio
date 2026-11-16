import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackSummary } from '@shared/model/pack'
import type { PackCacheControl, PackService } from '../../src/main/services/packs'
import { createTestEnv, json, makePng, type TestEnv } from './packs-fixtures'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createHistoryService } = await import('../../src/main/services/history')
const { createBriefService } = await import('../../src/main/services/brief')
const { createMergeService } = await import('../../src/main/services/merge')

const T = (p: string): string => `assets/minecraft/textures/${p}.png`
const RED = makePng(16, 16, [255, 0, 0, 255])
const BLUE = makePng(16, 16, [0, 0, 255, 255])
const GREEN = makePng(16, 16, [0, 255, 0, 255])

async function put(folder: string, path: string, data: Uint8Array | string): Promise<void> {
  const abs = join(folder, ...path.split('/'))
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, data)
}

describe('merge service', () => {
  let env: TestEnv
  let history: ReturnType<typeof createHistoryService>
  let brief: ReturnType<typeof createBriefService>
  let merge: ReturnType<typeof createMergeService>
  let a: PackSummary
  let b: PackSummary
  let target: PackSummary

  beforeEach(async () => {
    env = await createTestEnv()
    const packs = env.service as PackService & PackCacheControl
    history = createHistoryService({
      locate: (id) => packs.locate(id),
      onFilesChanged: (location, paths) => packs.invalidate(location, paths),
      notifyChanged: () => undefined,
      warn: () => undefined
    })
    brief = createBriefService({ locate: (id) => packs.locate(id) })
    merge = createMergeService({ packs, history, brief })
    a = await packs.create({ name: 'Fire', base: 'vanilla', authoringVersion: '26.3' })
    b = await packs.create({ name: 'Ice', base: 'empty', authoringVersion: '26.3' })
    target = await packs.create({ name: 'Target', base: 'empty', authoringVersion: '26.3' })
  })

  afterEach(async () => {
    await env.cleanup()
  })

  it('classifies files: added, identical, merged JSON, conflicts by priority', async () => {
    await put(a.folder, T('block/stone'), RED)
    await put(b.folder, T('block/stone'), BLUE)
    await put(a.folder, T('block/dirt'), GREEN)
    await put(b.folder, T('block/dirt'), GREEN)
    await put(target.folder, T('block/dirt'), GREEN)
    await put(b.folder, T('item/ruby'), RED)
    await put(a.folder, 'assets/minecraft/lang/en_us.json', json({ 'block.stone': 'Hot stone' }))
    await put(b.folder, 'assets/minecraft/lang/en_us.json', json({ 'block.ice': 'Ice' }))

    const plan = await merge.preview({
      sources: [a.id, b.id],
      target: { kind: 'pack', packId: target.id },
      mergeBriefs: false
    })
    expect(plan.target).toMatchObject({ packId: target.id, name: 'Target', created: false })
    expect(plan.added).toEqual([T('item/ruby')])
    expect(plan.identical).toBe(1)
    expect(plan.merged).toEqual(['assets/minecraft/lang/en_us.json'])
    expect(plan.conflicts).toHaveLength(1)
    const stone = plan.conflicts[0]!
    expect(stone).toMatchObject({ path: T('block/stone'), kind: 'png', choice: a.id })
    expect(stone.candidates.map((c) => c.originName)).toEqual(['Fire', 'Ice'])
    expect(stone.candidates[0]!.png).toBeInstanceOf(Uint8Array)

    // Choose the lower-priority source for the conflict.
    const result = await merge.apply({ planId: plan.id, choices: { [T('block/stone')]: b.id } })
    expect(result).toMatchObject({ written: 3, created: false, briefMerged: false })
    expect(
      new Uint8Array(await readFile(join(target.folder, ...T('block/stone').split('/'))))
    ).toEqual(BLUE)
    expect(
      JSON.parse(await readFile(join(target.folder, 'assets/minecraft/lang/en_us.json'), 'utf8'))
    ).toEqual({ 'block.stone': 'Hot stone', 'block.ice': 'Ice' })
    // One history entry, undoable.
    const state = await history.get(target.id)
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({
      source: 'merge',
      label: { key: 'merge', params: { count: 3, packs: 2 } }
    })
    await history.undo(target.id)
    await expect(stat(join(target.folder, ...T('item/ruby').split('/')))).rejects.toThrow()
    // A plan is applied once.
    await expect(merge.apply({ planId: plan.id, choices: {} })).rejects.toMatchObject({
      code: 'merge.planExpired'
    })
  })

  it('sends a selection to a new pack, migrating paths from an older source version', async () => {
    const old = await env.service.create({ name: 'Old', base: 'empty', authoringVersion: '26.2' })
    await put(old.folder, T('trims/color_palettes/amethyst'), RED)
    await put(old.folder, `${T('trims/color_palettes/amethyst')}.mcmeta`, json({ animation: {} }))
    await put(old.folder, T('item/light'), RED)
    await put(old.folder, T('block/stone'), RED)
    await put(old.folder, T('block/dirt'), RED)

    const plan = await merge.preview({
      sources: [old.id],
      target: { kind: 'new', name: 'Sent', description: '' },
      paths: [T('trims/color_palettes/amethyst'), T('item/light'), T('block/stone')],
      mergeBriefs: false
    })
    // A new pack from a 26.2 source stays on 26.2: nothing to migrate.
    expect(plan.target).toMatchObject({ name: 'Sent', authoringVersion: '26.2', created: true })
    expect(plan.added).toHaveLength(4)
    expect(plan.added).not.toContain(T('block/dirt'))

    const into = await merge.preview({
      sources: [old.id],
      target: { kind: 'pack', packId: target.id },
      paths: [T('trims/color_palettes/amethyst'), T('item/light')],
      mergeBriefs: false
    })
    // Into a 26.3 pack: the trim palette is renamed, the light texture no longer exists.
    expect(into.renamed).toBe(2)
    expect(into.added).toEqual([
      T('palettes/trim/amethyst'),
      `${T('palettes/trim/amethyst')}.mcmeta`
    ])
    expect(into.skipped).toEqual([
      { path: T('item/light'), origin: old.id, reason: 'notInVersion' }
    ])

    const created = await merge.apply({ planId: plan.id, choices: {} })
    expect(created.created).toBe(true)
    expect(created.pack).toMatchObject({ name: 'Sent', authoringVersion: '26.2', base: 'empty' })
    // The 4 files and the source's pack.png (a new pack takes the top source's icon).
    expect(created.written).toBe(5)
    await expect(
      stat(join(created.pack.folder, ...T('block/stone').split('/')))
    ).resolves.toBeTruthy()
  })

  it('merges style briefs on request and refuses a target that is also a source', async () => {
    await brief.update(a.id, { palette: [{ hex: '#ff6a00' }], rules: ['Flames everywhere'] })
    await brief.update(target.id, { theme: 'Mixed' })
    await put(a.folder, T('block/stone'), RED)
    const plan = await merge.preview({
      sources: [a.id],
      target: { kind: 'pack', packId: target.id },
      mergeBriefs: true
    })
    const result = await merge.apply({ planId: plan.id, choices: {} })
    expect(result.briefMerged).toBe(true)
    const merged = await brief.get(target.id)
    expect(merged).toMatchObject({
      theme: 'Mixed',
      palette: [{ hex: '#ff6a00' }],
      rules: ['Flames everywhere']
    })
    expect(merged.decisions.at(-1)!.text).toContain('Fire')

    await expect(
      merge.preview({ sources: [a.id], target: { kind: 'pack', packId: a.id }, mergeBriefs: false })
    ).rejects.toMatchObject({ code: 'merge.targetIsSource' })
    await expect(
      merge.preview({
        sources: ['nope'],
        target: { kind: 'pack', packId: a.id },
        mergeBriefs: false
      })
    ).rejects.toMatchObject({ code: 'packs.notFound' })
  })
})
