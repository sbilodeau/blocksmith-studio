import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { SettingsService } from '../../src/main/services/settings'

describe('SettingsService (filesystem)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blocksmith-settings-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('starts with defaults when no file exists', async () => {
    const service = SettingsService.forUserData(dir)
    const settings = await service.load()
    expect(settings.language).toBe('en')
  })

  it('persists updates atomically and reloads them', async () => {
    const service = SettingsService.forUserData(dir)
    await service.load()
    await service.update({ language: 'fr', theme: 'dark' })

    const raw = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
    expect(raw.language).toBe('fr')

    const reloaded = SettingsService.forUserData(dir)
    expect((await reloaded.load()).theme).toBe('dark')
  })

  it('notifies listeners on change', async () => {
    const service = SettingsService.forUserData(dir)
    await service.load()
    const seen: string[] = []
    service.onChange((s) => seen.push(s.language))
    await service.update({ language: 'fr' })
    expect(seen).toEqual(['fr'])
  })

  it('stores main-only paths (workspace, Minecraft folders) without duplicates', async () => {
    const service = SettingsService.forUserData(dir)
    await service.load()
    await service.setWorkspacePath('/tmp/ws')
    await service.addMinecraftPath('/games/mc')
    await service.addMinecraftPath('/games/mc')
    const reloaded = SettingsService.forUserData(dir)
    const s = await reloaded.load()
    expect(s.workspacePath).toBe('/tmp/ws')
    expect(s.minecraftPaths).toEqual(['/games/mc'])
    await reloaded.removeMinecraftPath('/games/mc')
    expect(reloaded.get().minecraftPaths).toEqual([])
  })

  it('falls back to defaults and keeps a backup when the file is corrupted', async () => {
    await writeFile(join(dir, 'settings.json'), '{ not json', 'utf8')
    const service = SettingsService.forUserData(dir)
    const settings = await service.load()
    expect(settings.language).toBe('en')
    expect(await readFile(join(dir, 'settings.json.bak'), 'utf8')).toBe('{ not json')
  })

  it('falls back to defaults when the file has invalid values', async () => {
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ language: 'klingon' }), 'utf8')
    const service = SettingsService.forUserData(dir)
    expect((await service.load()).language).toBe('en')
  })
})
