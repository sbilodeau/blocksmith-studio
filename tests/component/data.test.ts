import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'
import { NDialogProvider, NMessageProvider } from 'naive-ui'
import type { DataEntry } from '@shared/model/data'
import type { CreationProposal } from '@shared/ai/types'
import { useDataStore } from '@renderer/stores/data'
import NewDataDialog from '@renderer/components/data/NewDataDialog.vue'
import DataEditor from '@renderer/components/data/DataEditor.vue'
import CreationReview from '@renderer/components/ai/CreationReview.vue'
import DataExplain from '@renderer/components/data/DataExplain.vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { routes } from '@renderer/router'
import { useAiStore } from '@renderer/stores/ai'
import { createAppI18n } from '@renderer/i18n'
import { fakeBridge } from './setup'

const RECIPE = 'data/minecraft/recipe/stone_slab.json'
const ENTRIES: DataEntry[] = [
  {
    path: RECIPE,
    namespace: 'minecraft',
    kind: 'recipe',
    id: 'minecraft:stone_slab',
    status: 'vanilla'
  },
  {
    path: 'data/fire/recipe/ruby.json',
    namespace: 'fire',
    kind: 'recipe',
    id: 'fire:ruby',
    status: 'added'
  },
  {
    path: 'data/minecraft/tags/item/planks.json',
    namespace: 'minecraft',
    kind: 'tag',
    id: 'minecraft:planks',
    registry: 'item',
    status: 'modified'
  }
]

function mountWith(component: unknown, props: Record<string, unknown>): VueWrapper {
  const Host = defineComponent({
    setup: () => () =>
      h(NDialogProvider, () => h(NMessageProvider, () => h(component as never, props)))
  })
  const router = createRouter({ history: createMemoryHistory(), routes })
  return mount(Host, { global: { plugins: [createAppI18n(), router] }, attachTo: document.body })
}

beforeEach(() => {
  setActivePinia(createPinia())
  fakeBridge.calls = []
  fakeBridge.dataList = {
    entries: [...ENTRIES],
    vanillaData: true,
    ids: { items: ['minecraft:stone', 'minecraft:stone_slab'], blocks: [], tags: {} }
  }
  fakeBridge.dataFiles = {}
  fakeBridge.providers = []
  fakeBridge.models = []
  document.body.innerHTML = ''
})

describe('data store', () => {
  it('loads, counts per kind and filters by kind, status and search', async () => {
    const store = useDataStore('p1')
    await store.load()
    expect(store.counts.recipe).toEqual({ count: 2, changed: 1 })
    expect(store.counts.tag).toEqual({ count: 1, changed: 1 })
    expect(store.changedCount).toBe(2)
    expect(store.visible.map((e) => e.id)).toEqual(['minecraft:stone_slab', 'fire:ruby'])
    store.statusFilter = 'changed'
    expect(store.visible.map((e) => e.id)).toEqual(['fire:ruby'])
    store.statusFilter = 'all'
    store.search = 'slab'
    expect(store.visible.map((e) => e.id)).toEqual(['minecraft:stone_slab'])
    store.setKind('tag')
    store.search = ''
    expect(store.visible.map((e) => e.id)).toEqual(['minecraft:planks'])
    expect(store.context.items?.has('minecraft:stone')).toBe(true)
  })

  it('creates (and opens) files, removes added ones', async () => {
    const store = useDataStore('p1')
    await store.load()
    await store.create('data/fire/function/start.mcfunction', 'say hi\n')
    expect(store.editing).toBe('data/fire/function/start.mcfunction')
    expect(store.kind).toBe('function')
    expect(store.counts.function.count).toBe(1)
    await store.remove('data/fire/recipe/ruby.json')
    expect(store.entry('data/fire/recipe/ruby.json')).toBeUndefined()
    await store.remove('data/minecraft/tags/item/planks.json')
    expect(store.entry('data/minecraft/tags/item/planks.json')?.status).toBe('vanilla')
  })
})

describe('new data file dialog', () => {
  it('builds the path, flags existing files and creates from a template', async () => {
    const store = useDataStore('p1')
    await store.load()
    const show = ref(true)
    const wrapper = mountWith(NewDataDialog, {
      show: show.value,
      'onUpdate:show': (v: boolean) => (show.value = v),
      packId: 'p1',
      packName: 'Fire Pack'
    })
    await flushPromises()
    const input = document.querySelector('[data-testid="data-new-name"] input') as HTMLInputElement
    input.value = 'ruby'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    // fire_pack namespace by default: data/fire_pack/recipe/ruby.json is new.
    expect(document.body.textContent).toContain('data/fire_pack/recipe/ruby.json')
    ;(document.querySelector('[data-testid="data-new-create"]') as HTMLButtonElement).click()
    await flushPromises()
    const call = fakeBridge.calls.find((c) => c.channel === 'data.create')!
    const payload = call.payload as { path: string; text: string }
    expect(payload.path).toBe('data/fire_pack/recipe/ruby.json')
    expect(JSON.parse(payload.text)).toMatchObject({ type: 'minecraft:crafting_shaped' })
    expect(store.editing).toBe('data/fire_pack/recipe/ruby.json')
    wrapper.unmount()
  })
})

describe('data editor', () => {
  it('shows the file with its issues, and saves edits', async () => {
    fakeBridge.dataFiles[RECIPE] = {
      path: RECIPE,
      text: '{"type": "minecraft:crafting_shaped", "pattern": ["##"], "key": {"#": "minecraft:stone"}, "result": {"id": "minecraft:rubyy"}}',
      origin: 'pack',
      vanillaText: '{}'
    }
    const store = useDataStore('p1')
    await store.load()
    store.open(RECIPE)
    const wrapper = mountWith(DataEditor, { packId: 'p1' })
    await flushPromises()
    expect(document.querySelector('[data-testid="data-name"]')!.textContent).toBe(
      'minecraft:stone_slab'
    )
    expect(document.querySelector('[data-testid="data-summary"]')!.textContent).toContain(
      '1 warning'
    )
    expect(document.querySelector('[data-testid="data-issue-0"]')!.textContent).toContain(
      'Minecraft has no item "minecraft:rubyy"'
    )
    expect(
      document.querySelector('[data-testid="code-editor"] .cm-content')!.textContent
    ).toContain('minecraft:crafting_shaped')
    // Format rewrites the text (a change to save).
    ;(document.querySelector('[data-testid="data-format"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(document.querySelector('[data-testid="data-dirty"]')).not.toBeNull()
    ;(document.querySelector('[data-testid="data-save"]') as HTMLButtonElement).click()
    await flushPromises()
    const save = fakeBridge.calls.find((c) => c.channel === 'data.save')!.payload as {
      text: string
    }
    expect(save.text).toBe(
      `${JSON.stringify(JSON.parse(fakeBridge.dataFiles[RECIPE]!.text!), null, 2)}\n`
    )
    wrapper.unmount()
  })
})

describe('creation plan review', () => {
  it('shows a write_json step with its path and file', async () => {
    const proposal: CreationProposal = {
      id: 'x',
      runId: 'r',
      agent: 'creation',
      kind: 'plan',
      packId: 'p1',
      status: 'pending',
      steps: [
        {
          id: 'j1',
          callId: 'c1',
          tool: 'write_json',
          args: { path: 'data/fire/recipe/saddle.json' },
          kind: 'mutate',
          description: {
            key: 'ops.writeJsonNew',
            params: { path: 'data/fire/recipe/saddle.json' }
          },
          dependsOn: [],
          json: {
            path: 'data/fire/recipe/saddle.json',
            text: '{\n  "type": "x"\n}\n',
            previous: null,
            warnings: 2
          }
        }
      ]
    }
    const wrapper = mountWith(CreationReview, { proposal })
    await flushPromises()
    const text = document.body.textContent!
    expect(text).toContain('Create data/fire/recipe/saddle.json')
    expect(text).toContain('New file')
    expect(text).toContain('2 warnings')
    expect(document.querySelector('[data-testid="plan-json"] pre')!.textContent).toContain(
      '"type": "x"'
    )
    // No texture step: the button just applies.
    expect(document.querySelector('[data-testid="plan-apply"]')!.textContent).toContain('Apply')
    wrapper.unmount()
  })
})

describe('explain panel', () => {
  const text = '{"type": "minecraft:crafting_shaped"}'

  it('asks main for an explanation with the editor text and the UI language, and shows the streamed answer', async () => {
    fakeBridge.providers = [
      {
        id: 'fake',
        kind: 'ollama',
        label: 'Fake',
        baseUrl: 'http://localhost',
        enabled: true,
        hasKey: true,
        keyRequired: true
      }
    ]
    fakeBridge.models = [
      { id: 'm1', providerId: 'fake', label: 'M1', capabilities: { tools: true } }
    ]
    fakeBridge.settings = { ...fakeBridge.settings, language: 'fr' }
    const { useSettingsStore } = await import('@renderer/stores/settings')
    await useSettingsStore().load()
    useAiStore().init()
    const wrapper = mountWith(DataExplain, { packId: 'p1', path: RECIPE, text })
    await flushPromises()
    const req = fakeBridge.calls.find((c) => c.channel === 'ai.data.explain')!.payload
    expect(req).toEqual({
      packId: 'p1',
      path: RECIPE,
      text,
      model: { providerId: 'fake', modelId: 'm1' },
      language: 'fr',
      thinking: 'off'
    })
    fakeBridge.emit('ai.event', {
      runId: 'explain-1',
      type: 'text',
      delta: '**Résumé** : 3 dalles'
    })
    fakeBridge.emit('ai.event', { runId: 'explain-1', type: 'done', reason: 'end' })
    await flushPromises()
    // Markdown markup the model adds anyway is dropped.
    expect(document.querySelector('[data-testid="data-explain-text"]')!.textContent).toBe(
      'Résumé : 3 dalles'
    )
    expect(document.querySelector('[data-testid="data-explain-run"]')!.textContent).toContain(
      'Explain again'
    )
    wrapper.unmount()
    fakeBridge.settings = { ...fakeBridge.settings, language: 'en' }
  })

  it('points to Settings when no AI provider is set up', async () => {
    const wrapper = mountWith(DataExplain, { packId: 'p2', path: RECIPE, text })
    await flushPromises()
    expect(document.body.textContent).toContain('Open Settings')
    expect(fakeBridge.calls.some((c) => c.channel === 'ai.data.explain')).toBe(false)
    wrapper.unmount()
  })
})
