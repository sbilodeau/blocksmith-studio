import { describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { NMessageProvider } from 'naive-ui'
import { createImage, encodePng } from '@shared/image'
import type { CreationProposal, ProposalStep } from '@shared/ai/types'
import CreationReview from '@renderer/components/ai/CreationReview.vue'
import { createAppI18n } from '@renderer/i18n'
import './setup'

const PNG = encodePng(createImage(2, 2, [10, 10, 10, 255]))

function mountReview(props: Record<string, unknown>): VueWrapper {
  const pinia = createPinia()
  setActivePinia(pinia)
  const Host = defineComponent({
    setup: () => () => h(NMessageProvider, () => h(CreationReview as never, props))
  })
  return mount(Host, { global: { plugins: [pinia, createAppI18n()] }, attachTo: document.body })
}

const STEPS = [
  {
    id: 'b1',
    callId: 'c1',
    tool: 'update_style_brief',
    args: {},
    kind: 'memory',
    description: { key: 'ops.updateStyleBrief', params: { fields: 'theme' } },
    dependsOn: [],
    briefPatch: { theme: 'Fire' }
  },
  {
    id: 's1',
    callId: 'c2',
    tool: 'hue_shift',
    args: { degrees: -30 },
    kind: 'mutate',
    description: { key: 'ops.hueShift', params: { degrees: '-30' } },
    dependsOn: [],
    targets: ['a', 'b'],
    scope: { categories: ['ores'], count: 2, byCategory: { ores: 2 } },
    samples: [{ path: 'a', name: 'iron_ore', beforePng: PNG, afterPng: PNG, changedPixels: 4 }]
  },
  {
    id: 's2',
    callId: 'c3',
    tool: 'brightness',
    args: { delta: -0.2 },
    kind: 'mutate',
    description: { key: 'ops.brightness', params: { percent: '-20' } },
    dependsOn: ['s1'],
    targets: ['a', 'b', 'c'],
    scope: { count: 3, byCategory: {} }
  },
  {
    id: 'm1',
    callId: 'c4',
    tool: 'set_pack_meta',
    args: { name: 'Fire Pack' },
    kind: 'memory',
    description: { key: 'ops.setPackMeta', params: { fields: 'name' } },
    dependsOn: [],
    packMeta: { name: 'Fire Pack' }
  }
] as ProposalStep[]

const PROPOSAL: CreationProposal = {
  id: 'p1',
  runId: 'r1',
  agent: 'creation',
  kind: 'plan',
  packId: 'pack',
  steps: STEPS,
  status: 'pending'
}

describe('CreationReview', () => {
  it('shows each step with its scope, samples and changes; apply emits the ticked steps', async () => {
    const applied: unknown[] = []
    const wrapper = mountReview({
      proposal: PROPOSAL,
      onApply: (ids: unknown) => applied.push(ids)
    })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('Plan: 4 steps')
    expect(text).toContain('Ores')
    expect(text).toContain('2 textures')
    expect(text).toContain('Whole pack')
    expect(text).toContain('Name: Fire Pack')
    expect(
      wrapper.findAll(
        '[data-testid="plan-step-hue_shift"] img, [data-testid="plan-step-hue_shift"] canvas'
      ).length
    ).toBeGreaterThan(0)
    expect(wrapper.find('[data-testid="plan-apply"]').text()).toBe(
      'Apply 2 steps (up to 5 textures)'
    )

    // Unticking the first texture step: the second one was previewed on top of it.
    await wrapper
      .find(
        '[data-testid="plan-step-hue_shift"] input[type="checkbox"], [data-testid="plan-step-hue_shift"] .n-checkbox'
      )
      .trigger('click')
    expect(wrapper.text()).toContain('previewed on top of a step you unticked')
    expect(wrapper.find('[data-testid="plan-apply"]').text()).toBe(
      'Apply 1 step (up to 3 textures)'
    )

    await wrapper.find('[data-testid="plan-apply"]').trigger('click')
    expect(applied).toEqual([['b1', 's2', 'm1']])
    wrapper.unmount()
  })

  it('offers Stop while applying, and shows the outcome once decided', async () => {
    const stops: unknown[] = []
    const busy = mountReview({ proposal: PROPOSAL, busy: true, onStop: () => stops.push(1) })
    await flushPromises()
    expect(busy.find('[data-testid="plan-reject"]').exists()).toBe(false)
    await busy.find('[data-testid="plan-stop"]').trigger('click')
    expect(stops).toEqual([1])
    busy.unmount()

    const done = mountReview({ proposal: { ...PROPOSAL, status: 'partially-applied' } })
    await flushPromises()
    expect(done.find('[data-testid="plan-apply"]').exists()).toBe(false)
    expect(done.text()).toContain('Partly applied')
    done.unmount()
  })
})
