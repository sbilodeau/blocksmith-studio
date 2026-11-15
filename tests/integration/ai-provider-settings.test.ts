import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { SettingsService } from '../../src/main/services/settings'

describe('SettingsService provider methods', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blocksmith-ai-settings-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('upserts and deletes providers, persisting them without secrets', async () => {
    const service = SettingsService.forUserData(dir)
    await service.load()
    expect(service.get().ai.providers.map((p) => p.id)).toEqual(['ollama-cloud'])

    const self = {
      id: 'self',
      kind: 'ollama' as const,
      label: 'Self-hosted',
      baseUrl: 'http://localhost:11434',
      enabled: true
    }
    await service.saveProvider(self)
    await service.saveProvider({ ...service.get().ai.providers[0]!, enabled: false })
    expect(service.get().ai.providers.map((p) => [p.id, p.enabled])).toEqual([
      ['ollama-cloud', false],
      ['self', true]
    ])

    await service.deleteProvider('ollama-cloud')
    const reloaded = SettingsService.forUserData(dir)
    expect((await reloaded.load()).ai.providers).toEqual([self])
    expect(await readFile(join(dir, 'settings.json'), 'utf8')).not.toMatch(/key/i)
  })
})
