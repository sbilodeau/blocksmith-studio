import { describe, expect, it } from 'vitest'
import { SettingsPatchSchema, applySettingsPatch, defaultSettings } from '@shared/model/settings'

describe('settings model', () => {
  it('defaults to English, system theme and auto update checks', () => {
    const s = defaultSettings()
    expect(s).toMatchObject({
      schemaVersion: 1,
      language: 'en',
      theme: 'system',
      updates: { autoCheck: true },
      minecraftPaths: [],
      allowMojangDownload: false
    })
  })

  it('defaults to the Ollama Cloud provider and editor agent defaults', () => {
    const s = defaultSettings()
    expect(s.ai.providers).toEqual([
      {
        id: 'ollama-cloud',
        kind: 'ollama',
        label: 'Ollama Cloud',
        baseUrl: 'https://ollama.com',
        enabled: true
      }
    ])
    expect(s.ai.agents.editor).toEqual({
      thinking: false,
      maxIterations: 6,
      imageMode: 'vision+grid'
    })
  })

  it('applies per-agent patches without touching other agents', () => {
    const next = applySettingsPatch(defaultSettings(), {
      aiAgents: {
        editor: { model: { providerId: 'ollama-cloud', modelId: 'gemma3' }, thinking: true }
      }
    })
    expect(next.ai.agents.editor.model?.modelId).toBe('gemma3')
    expect(next.ai.agents.editor.thinking).toBe(true)
    expect(next.ai.agents.editor.maxIterations).toBe(6)
    expect(next.ai.agents.navigation.model).toBeUndefined()
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
