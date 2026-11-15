import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { NMessageProvider, NSelect } from 'naive-ui'
import type { EvalReport, ModelInfo, ProviderStatus } from '@shared/ai/types'
import { defaultSettings } from '@shared/model/settings'
import AiSettings from '@renderer/components/ai/AiSettings.vue'
import ProviderForm from '@renderer/components/ai/ProviderForm.vue'
import ModelTest from '@renderer/components/ai/ModelTest.vue'
import { createAppI18n } from '@renderer/i18n'
import { useAiStore } from '@renderer/stores/ai'
import { useSettingsStore } from '@renderer/stores/settings'
import { fakeBridge } from './setup'

const CLOUD: ProviderStatus = {
  id: 'ollama-cloud',
  kind: 'ollama',
  label: 'Ollama Cloud',
  baseUrl: 'https://ollama.com',
  enabled: true,
  hasKey: true,
  keyRequired: true
}

const MODELS: ModelInfo[] = [
  {
    id: 'qwen3:32b',
    providerId: 'ollama-cloud',
    label: 'qwen3:32b',
    capabilities: { tools: true, thinking: true }
  },
  {
    id: 'tiny-chat',
    providerId: 'ollama-cloud',
    label: 'tiny-chat',
    capabilities: { tools: false },
    pricing: { inPerMTok: 0.1, outPerMTok: 0.2, source: 'hint' },
    costTier: 1
  }
]

function report(modelId: string, rate: number, costUsd?: number): EvalReport {
  const score = { total: 16, passed: Math.round((rate / 100) * 16), rate }
  return {
    model: { providerId: 'ollama-cloud', modelId },
    overall: score,
    fr: score,
    en: score,
    gap: 0,
    ok: rate >= 90,
    avgLatencyMs: 1200,
    inputTokens: 1000,
    outputTokens: 100,
    ...(costUsd !== undefined ? { costUsd } : {}),
    stopped: false,
    failures:
      rate < 100
        ? [{ caseId: 'darker', language: 'fr', phrase: 'plus sombre', calls: 'brightness({})' }]
        : [],
    markdown: `## ${modelId}`
  }
}

async function mountWith(
  component: unknown,
  props: Record<string, unknown> = {}
): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  await useSettingsStore().load()
  const Host = defineComponent({
    setup: () => () => h(NMessageProvider, () => h(component as never, props))
  })
  const wrapper = mount(Host, {
    global: { plugins: [pinia, createAppI18n()] },
    attachTo: document.body
  })
  await flushPromises()
  return wrapper
}

describe('AI settings (M4)', () => {
  beforeEach(() => {
    fakeBridge.settings = defaultSettings()
    fakeBridge.providers = [CLOUD]
    fakeBridge.models = MODELS
    fakeBridge.evalReports = {}
    fakeBridge.calls = []
  })

  it('adds OpenRouter from its preset, with the attribution headers', async () => {
    const wrapper = await mountWith(ProviderForm)
    // The form opens on the OpenRouter preset.
    expect(
      (wrapper.find('[data-testid="provider-url"] input').element as HTMLInputElement).value
    ).toBe('https://openrouter.ai/api/v1')
    await wrapper.find('[data-testid="provider-form-save"]').trigger('click')
    await flushPromises()
    const save = fakeBridge.calls.find((c) => c.channel === 'ai.providers.save')
    expect(save?.payload).toEqual({
      id: 'openrouter',
      kind: 'openai-compatible',
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      enabled: true,
      extraHeaders: {
        'HTTP-Referer': 'https://github.com/sbilodeau/blocksmith-studio',
        'X-Title': 'Blocksmith Studio'
      }
    })
    wrapper.unmount()
  })

  it('rejects malformed extra header lines without saving', async () => {
    const wrapper = await mountWith(ProviderForm)
    await wrapper.find('[data-testid="provider-headers"] textarea').setValue('no colon here')
    await wrapper.find('[data-testid="provider-form-save"]').trigger('click')
    await flushPromises()
    expect(fakeBridge.calls.some((c) => c.channel === 'ai.providers.save')).toBe(false)
    expect(wrapper.text()).toContain('Each line must look like Name: value.')
    wrapper.unmount()
  })

  it('lists every model with its price and saves a user correction', async () => {
    const wrapper = await mountWith(AiSettings)
    const table = wrapper.find('[data-testid="model-table"]')
    expect(table.text()).toContain('qwen3:32b')
    expect(table.text()).toContain('tiny-chat')
    expect(table.text()).toContain('$0.1 in / $0.2 out')
    expect(table.text()).toContain('Unknown')
    await wrapper.find('[data-testid="model-adjust-qwen3:32b"]').trigger('click')
    await flushPromises()
    const inputs = document.querySelectorAll<HTMLInputElement>(
      '[data-testid="override-price-in"] input, [data-testid="override-price-out"] input'
    )
    for (const [i, value] of ['0.5', '2'].entries()) {
      inputs[i]!.value = value
      inputs[i]!.dispatchEvent(new Event('input'))
      inputs[i]!.dispatchEvent(new Event('blur'))
    }
    await flushPromises()
    ;(document.querySelector('[data-testid="override-save"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(fakeBridge.settings.ai.modelOverrides).toEqual([
      {
        providerId: 'ollama-cloud',
        modelId: 'qwen3:32b',
        pricing: { inPerMTok: 0.5, outPerMTok: 2 }
      }
    ])
    // The list is reloaded so the new price and tier show.
    expect(fakeBridge.calls.filter((c) => c.channel === 'ai.models.list').length).toBeGreaterThan(1)
    wrapper.unmount()
  })

  it('pickers offer models without tools only when "show all" is on', async () => {
    const wrapper = await mountWith(AiSettings)
    const ai = useAiStore()
    expect(ai.pickerModels.map((m) => m.id)).toEqual(['qwen3:32b'])
    await wrapper.find('[data-testid="show-all-models"]').trigger('click')
    await flushPromises()
    expect(fakeBridge.settings.ai.showAllModels).toBe(true)
    expect(ai.pickerModels.map((m) => m.id)).toEqual(['qwen3:32b', 'tiny-chat'])
    wrapper.unmount()
  })

  it('compares several models side by side, best first', async () => {
    fakeBridge.settings = {
      ...defaultSettings(),
      ai: { ...defaultSettings().ai, showAllModels: true }
    }
    fakeBridge.evalReports = {
      'tiny-chat': report('tiny-chat', 62.5, 0.0004),
      'qwen3:32b': report('qwen3:32b', 100)
    }
    const wrapper = await mountWith(ModelTest)
    await useAiStore().loadProviders()
    await useAiStore().loadModels()
    const ai = useAiStore()
    expect(ai.pickerModels).toHaveLength(2)
    // Select both models through the store-backed select value.
    const select = wrapper.findComponent(NSelect)
    select.vm.$emit('update:value', ['ollama-cloud::tiny-chat', 'ollama-cloud::qwen3:32b'])
    await flushPromises()
    await wrapper.find('[data-testid="model-test-quick"]').trigger('click')
    await flushPromises()
    const runs = fakeBridge.calls.filter((c) => c.channel === 'ai.eval.run')
    expect(runs.map((c) => (c.payload as { model: { modelId: string } }).model.modelId)).toEqual([
      'tiny-chat',
      'qwen3:32b'
    ])
    const compare = wrapper.find('[data-testid="model-test-compare"]')
    expect(compare.exists()).toBe(true)
    expect(wrapper.find('[data-testid="compare-row-1"]').text()).toContain('qwen3:32b')
    expect(wrapper.find('[data-testid="compare-row-2"]').text()).toContain('$0.0004')
    expect(compare.text()).toContain('darker (fr)')
    wrapper.unmount()
  })
})
