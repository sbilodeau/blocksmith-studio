import { describe, expect, it } from 'vitest'
import { SettingsPatchSchema, applySettingsPatch, defaultSettings } from '@shared/model/settings'

describe('settings model', () => {
  it('defaults to English, system theme and auto update checks', () => {
    expect(defaultSettings()).toEqual({
      schemaVersion: 1,
      language: 'en',
      theme: 'system',
      updates: { autoCheck: true },
      minecraftPaths: [],
      allowMojangDownload: false
    })
  })

  it('applies a partial patch without touching other fields', () => {
    const next = applySettingsPatch(defaultSettings(), { language: 'fr' })
    expect(next.language).toBe('fr')
    expect(next.theme).toBe('system')
    expect(next.updates.autoCheck).toBe(true)
  })

  it('merges nested update preferences', () => {
    const next = applySettingsPatch(defaultSettings(), { updates: { autoCheck: false } })
    expect(next.updates.autoCheck).toBe(false)
  })

  it('rejects unknown keys and invalid values', () => {
    expect(SettingsPatchSchema.safeParse({ language: 'de' }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ apiKey: 'x' }).success).toBe(false)
  })
})
