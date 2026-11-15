import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decode } from 'fast-png'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestEnv, type TestEnv } from './packs-fixtures'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

describe('pack service: workspace and packs', () => {
  let env: TestEnv

  beforeEach(async () => {
    env = await createTestEnv()
  })

  afterEach(async () => {
    await env.cleanup()
  })

  it('defaults the workspace to <Documents>/Blocksmith Studio and honours the setting', async () => {
    expect(env.service.workspaceRoot()).toBe(join(env.documentsDir, 'Blocksmith Studio'))
    expect(env.service.packsDir()).toBe(join(env.documentsDir, 'Blocksmith Studio', 'packs'))
    env.workspace.path = join(env.root, 'custom')
    expect(env.service.workspaceRoot()).toBe(join(env.root, 'custom'))
    env.workspace.path = 'relative/path'
    expect(env.service.workspaceRoot()).toBe(join(env.documentsDir, 'Blocksmith Studio'))
  })

  it('setWorkspace creates the packs folder, persists the path and notifies', async () => {
    const target = join(env.root, 'ws')
    await expect(env.service.setWorkspace(target)).resolves.toBe(target)
    expect((await stat(join(target, 'packs'))).isDirectory()).toBe(true)
    expect(env.deps.setWorkspacePath).toHaveBeenCalledWith(target)
    expect(env.deps.notifyChanged).toHaveBeenCalledWith()
    expect(env.service.workspaceRoot()).toBe(target)
    await expect(env.service.setWorkspace('not/absolute')).rejects.toMatchObject({
      code: 'workspace.invalidPath'
    })
  })

  it('lists nothing when the workspace does not exist yet', async () => {
    await expect(env.service.list()).resolves.toEqual([])
  })

  it('creates a vanilla-based pack: project.json, pack.mcmeta, 64x64 pack.png, nothing else', async () => {
    const summary = await env.service.create({
      name: 'Fire Pack!',
      description: 'Hot stuff',
      base: 'vanilla',
      authoringVersion: '26.3'
    })
    expect(summary).toMatchObject({
      id: 'pack0001',
      name: 'Fire Pack!',
      description: 'Hot stuff',
      authoringVersion: '26.3',
      base: 'vanilla',
      changedCount: 0,
      folder: join(env.service.packsDir(), 'fire-pack')
    })
    expect(summary.iconUrl).toMatch(/^bs-asset:\/\/pack\/pack0001\/pack\.png\?v=/)

    // readdir returns native separators (backslashes on Windows); compare POSIX paths.
    const files = (await readdir(summary.folder, { recursive: true }))
      .map((f) => f.split('\\').join('/'))
      .sort()
    expect(files).toEqual(['.blocksmith', '.blocksmith/project.json', 'pack.mcmeta', 'pack.png'])

    const project = JSON.parse(
      await readFile(join(summary.folder, '.blocksmith/project.json'), 'utf8')
    )
    expect(project).toMatchObject({ schemaVersion: 1, id: 'pack0001', base: 'vanilla' })
    const mcmeta = JSON.parse(await readFile(join(summary.folder, 'pack.mcmeta'), 'utf8'))
    expect(mcmeta.pack.description).toBe('Hot stuff')

    const icon = decode(await readFile(join(summary.folder, 'pack.png')))
    expect([icon.width, icon.height]).toEqual([64, 64])
    // Upscaled from the (solid green) vanilla grass_block_side texture.
    expect(Array.from(icon.data.slice(0, 4))).toEqual([90, 160, 60, 255])
    expect(env.deps.notifyChanged).toHaveBeenCalledWith('pack0001')
  })

  it('creates an empty-based pack with a generated icon, and unique folder names', async () => {
    const a = await env.service.create({ name: 'Same', base: 'empty', authoringVersion: '26.3' })
    const b = await env.service.create({ name: 'Same', base: 'empty', authoringVersion: '26.3' })
    expect(a.folder.endsWith('same')).toBe(true)
    expect(b.folder.endsWith('same-2')).toBe(true)
    const icon = decode(await readFile(join(a.folder, 'pack.png')))
    expect([icon.width, icon.height]).toEqual([64, 64])
  })

  it('rejects unsupported versions and a vanilla base whose vanilla is not extracted', async () => {
    await expect(
      env.service.create({ name: 'X', base: 'empty', authoringVersion: '1.20.1' })
    ).rejects.toMatchObject({ code: 'packs.unsupportedVersion', params: { version: '1.20.1' } })
    await expect(
      env.service.create({ name: 'X', base: 'vanilla', authoringVersion: '26.2' })
    ).rejects.toMatchObject({ code: 'packs.vanillaNotReady', params: { version: '26.2' } })
    await expect(readdir(env.service.packsDir()).catch(() => [])).resolves.toEqual([])
  })

  it('lists packs newest first and skips invalid project files without crashing', async () => {
    await env.service.create({ name: 'Old', base: 'vanilla', authoringVersion: '26.3' })
    await env.service.create({ name: 'New', base: 'empty', authoringVersion: '26.3' })
    const packs = env.service.packsDir()
    await mkdir(join(packs, 'broken/.blocksmith'), { recursive: true })
    await writeFile(join(packs, 'broken/.blocksmith/project.json'), '{ nope')
    await mkdir(join(packs, 'invalid/.blocksmith'), { recursive: true })
    await writeFile(join(packs, 'invalid/.blocksmith/project.json'), '{"schemaVersion":2}')
    await mkdir(join(packs, 'no-project'), { recursive: true })
    await writeFile(join(packs, 'stray-file.txt'), 'x')

    const list = await env.service.list()
    expect(list.map((p) => p.name)).toEqual(['New', 'Old'])
  })

  it('get, reveal and delete (to trash) a pack', async () => {
    const created = await env.service.create({
      name: 'Gone',
      base: 'vanilla',
      authoringVersion: '26.3'
    })
    await expect(env.service.get(created.id)).resolves.toMatchObject({ name: 'Gone' })
    await env.service.reveal(created.id)
    expect(env.deps.showItemInFolder).toHaveBeenCalledWith(created.folder)

    await env.service.delete(created.id)
    expect(env.deps.trashItem).toHaveBeenCalledWith(created.folder)
    expect(env.deps.notifyChanged).toHaveBeenLastCalledWith(created.id)
    await expect(env.service.get(created.id)).rejects.toMatchObject({ code: 'packs.notFound' })
    await expect(env.service.list()).resolves.toEqual([])
  })

  it('finds a pack again after its folder was renamed outside the app', async () => {
    const created = await env.service.create({ name: 'A', base: 'empty', authoringVersion: '26.3' })
    const { rename } = await import('node:fs/promises')
    await rename(created.folder, join(env.service.packsDir(), 'renamed'))
    await expect(env.service.get(created.id)).resolves.toMatchObject({
      folder: join(env.service.packsDir(), 'renamed')
    })
  })
})
