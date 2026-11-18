import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { NDialogProvider, NMessageProvider } from 'naive-ui'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { CreationProposal, ItemDefinitionProposal } from '@shared/ai/types'
import { CustomItemSchema, type CustomItem } from '@shared/items/schema'
import { defaultSettings } from '@shared/model/settings'
import ItemReview from '@renderer/components/items/ItemReview.vue'
import ItemAgentPanel from '@renderer/components/items/ItemAgentPanel.vue'
import ItemExplain from '@renderer/components/items/ItemExplain.vue'
import CreationReview from '@renderer/components/ai/CreationReview.vue'
import { routes } from '@renderer/router'
import { useAiStore } from '@renderer/stores/ai'
import { useSettingsStore } from '@renderer/stores/settings'
import { createAppI18n } from '@renderer/i18n'
import { fakeBridge } from './setup'

const SWORD: CustomItem = CustomItemSchema.parse({
  schemaVersion: 1,
  id: 'ruby_sword',
  namespace: 'gems',
  kind: 'weapon',
  base: 'minecraft:stone_sword',
  names: { en_us: 'Ruby Sword', fr_fr: 'Épée en rubis' },
  handheld: true,
  durability: 1561,
  weapon: { attackDamage: 7, attackSpeed: 1.6 },
  recipe: {
    type: 'shaped',
    grid: [
      null,
      'minecraft:redstone',
      null,
      null,
      'minecraft:redstone',
      null,
      null,
      'minecraft:stick',
      null
    ],
    count: 1
  }
})
const STRONG: CustomItem = {
  ...SWORD,
  id: 'ruby_blade',
  names: { en_us: 'Ruby Blade', fr_fr: 'Lame de rubis' },
  weapon: { attackDamage: 9, attackSpeed: 1.6 },
  glint: true,
  recipe: { type: 'shapeless', ingredients: ['minecraft:emerald', 'minecraft:stick'], count: 2 }
}

function mountWith(component: unknown, props: Record<string, unknown>): VueWrapper {
  const Host = defineComponent({
    setup: () => () =>
      h(NDialogProvider, () => h(NMessageProvider, () => h(component as never, props)))
  })
  const router = createRouter({ history: createMemoryHistory(), routes })
  return mount(Host, { global: { plugins: [createAppI18n(), router] }, attachTo: document.body })
}

function proposal(status: ItemDefinitionProposal['status'] = 'pending'): ItemDefinitionProposal {
  return {
    id: 'ip1',
    runId: 'r',
    agent: 'item',
    kind: 'item',
    packId: 'p1',
    itemId: 'ruby_sword',
    // As the form sends it: defaults may be missing.
    before: { ...SWORD, lore: undefined, removeComponents: undefined } as Record<string, unknown>,
    after: STRONG,
    unknownIds: ['minecraft:ruby'],
    status
  }
}

async function withProvider(): Promise<void> {
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
  fakeBridge.models = [{ id: 'm1', providerId: 'fake', label: 'M1', capabilities: { tools: true } }]
  const settings = defaultSettings()
  // The item agent has no default model: it falls back to the creation agent's.
  settings.ai.agents.creation.model = { providerId: 'fake', modelId: 'm1' }
  fakeBridge.settings = settings
  await useSettingsStore().load()
  useAiStore().init()
}

beforeEach(() => {
  setActivePinia(createPinia())
  fakeBridge.calls = []
  fakeBridge.providers = []
  fakeBridge.models = []
  fakeBridge.settings = defaultSettings()
  document.body.innerHTML = ''
})

describe('item proposal review', () => {
  it('lists the changed fields, warns about unknown ids, and emits apply / discard', async () => {
    const applied: CustomItem[] = []
    let discarded = 0
    const wrapper = mountWith(ItemReview, {
      proposal: proposal(),
      currentItem: SWORD,
      onApply: (item: CustomItem) => applied.push(item),
      onDiscard: () => discarded++
    })
    await flushPromises()
    const rows = [...document.querySelectorAll('[data-testid="item-proposal-changes"] li')].map(
      (li) =>
        [...li.querySelectorAll('.label, .before, .after')].map((s) => s.textContent).join(' | ')
    )
    expect(rows).toEqual([
      'Name (en_us) | Ruby Sword | Ruby Blade',
      'Name (fr_fr) | Épée en rubis | Lame de rubis',
      'Id | ruby_sword | ruby_blade',
      'Enchanted shimmer | not set | yes',
      'Attack damage | 7 | 9',
      'Recipe | - redstone - / - redstone - / - stick - (x1) | emerald + stick (x2)'
    ])
    expect(document.body.textContent).toContain('Renamed to ruby_blade')
    expect(document.body.textContent).toContain(
      'This Minecraft version does not have: minecraft:ruby'
    )
    expect(document.body.textContent).not.toContain('applying replaces')
    ;(document.querySelector('[data-testid="item-proposal-apply"]') as HTMLButtonElement).click()
    ;(document.querySelector('[data-testid="item-proposal-discard"]') as HTMLButtonElement).click()
    expect(applied).toEqual([STRONG])
    expect(discarded).toBe(1)
    wrapper.unmount()

    const outdated = mountWith(ItemReview, {
      proposal: proposal(),
      currentItem: { ...SWORD, maxStack: 1 }
    })
    await flushPromises()
    expect(document.body.textContent).toContain('applying replaces those edits')
    outdated.unmount()

    const done = mountWith(ItemReview, { proposal: proposal('applied'), currentItem: STRONG })
    await flushPromises()
    expect(document.querySelector('[data-testid="item-proposal-apply"]')).toBeNull()
    expect(document.querySelector('[data-testid="item-proposal-status"]')!.textContent).toContain(
      'Applied to the form'
    )
    done.unmount()
  })
})

describe('item agent panel', () => {
  it('sends the form definition with the message, shows the proposal and applies it to the form', async () => {
    await withProvider()
    const applied: CustomItem[] = []
    const wrapper = mountWith(ItemAgentPanel, {
      packId: 'p1',
      item: SWORD,
      onApply: (item: CustomItem) => applied.push(item)
    })
    await flushPromises()
    expect(document.querySelector('[data-testid="item-agent-context"]')!.textContent).toContain(
      'About Ruby Sword'
    )
    await wrapper.find('[data-testid="agent-input"] textarea').setValue('make it deal 9 damage')
    ;(document.querySelector('[data-testid="agent-send"]') as HTMLButtonElement).click()
    await flushPromises()
    const req = fakeBridge.calls.find((c) => c.channel === 'ai.item.send')!.payload
    expect(req).toEqual({
      packId: 'p1',
      id: 'ruby_sword',
      item: SWORD,
      message: 'make it deal 9 damage',
      model: { providerId: 'fake', modelId: 'm1' },
      language: 'en',
      thinking: 'off'
    })
    fakeBridge.emit('ai.event', { runId: 'item-1', type: 'text', delta: 'It now deals 9.' })
    fakeBridge.emit('ai.event', {
      runId: 'item-1',
      type: 'proposal',
      proposal: { ...proposal(), before: SWORD }
    })
    fakeBridge.emit('ai.event', { runId: 'item-1', type: 'done', reason: 'end' })
    await flushPromises()
    ;(document.querySelector('[data-testid="item-proposal-apply"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(applied).toEqual([STRONG])
    expect(useAiStore().session('p1', 'item').proposals['ip1']!.status).toBe('applied')
    expect(document.querySelector('[data-testid="item-proposal-status"]')).not.toBeNull()
    wrapper.unmount()
  })
})

describe('item explain panel', () => {
  it('asks main for an explanation of the form definition and shows the answer', async () => {
    await withProvider()
    const wrapper = mountWith(ItemExplain, { packId: 'p1', item: SWORD })
    await flushPromises()
    const req = fakeBridge.calls.find((c) => c.channel === 'ai.item.explain')!.payload
    expect(req).toEqual({
      packId: 'p1',
      id: 'ruby_sword',
      item: SWORD,
      model: { providerId: 'fake', modelId: 'm1' },
      language: 'en',
      thinking: 'off'
    })
    fakeBridge.emit('ai.event', { runId: 'item-explain-1', type: 'text', delta: '**A sword**' })
    fakeBridge.emit('ai.event', { runId: 'item-explain-1', type: 'done', reason: 'end' })
    await flushPromises()
    expect(document.querySelector('[data-testid="item-explain-text"]')!.textContent).toBe('A sword')
    // The data editor's explanation is another session.
    expect(useAiStore().session('p1', 'explain').items).toEqual([])
    wrapper.unmount()
  })
})

describe('creation plan review with custom items', () => {
  it('shows write_item and delete_item steps', async () => {
    const plan: CreationProposal = {
      id: 'x',
      runId: 'r',
      agent: 'creation',
      kind: 'plan',
      packId: 'p1',
      status: 'pending',
      steps: [
        {
          id: 'i1',
          callId: 'c1',
          tool: 'write_item',
          args: { id: 'ruby_sword' },
          kind: 'mutate',
          description: { key: 'ops.writeItemNew', params: { name: 'Ruby Sword' } },
          dependsOn: [],
          item: {
            op: 'write',
            id: 'ruby_sword',
            item: SWORD,
            isNew: true,
            textureFrom: 'assets/minecraft/textures/item/diamond_sword.png'
          }
        },
        {
          id: 'i2',
          callId: 'c2',
          tool: 'delete_item',
          args: { id: 'ruby' },
          kind: 'mutate',
          description: { key: 'ops.deleteItem', params: { name: 'Ruby' } },
          dependsOn: [],
          item: { op: 'delete', id: 'ruby' }
        }
      ]
    }
    const wrapper = mountWith(CreationReview, { proposal: plan })
    await flushPromises()
    const text = document.body.textContent!
    expect(text).toContain('Create the item Ruby Sword')
    expect(text).toContain('New item')
    expect(text).toContain('weapon, base minecraft:stone_sword')
    expect(text).toContain('Texture from assets/minecraft/textures/item/diamond_sword.png')
    expect(text).toContain('Delete the item Ruby')
    expect(text).toContain('Deleted item')
    // Item steps are not texture steps: the button just applies.
    expect(document.querySelector('[data-testid="plan-apply"]')!.textContent!.trim()).toBe('Apply')
    wrapper.unmount()
  })
})
