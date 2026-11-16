import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { NMessageProvider } from 'naive-ui'
import { createImage, encodePng } from '@shared/image'
import type { BulkItem } from '@shared/model/bulk'
import type { ProposalStep } from '@shared/ai/types'
import BulkReview from '@renderer/components/bulk/BulkReview.vue'
import BulkDialog from '@renderer/components/bulk/BulkDialog.vue'
import { createAppI18n } from '@renderer/i18n'
import { fakeBridge } from './setup'

const PNG = encodePng(createImage(2, 2, [10, 10, 10, 255]))
const item = (name: string): BulkItem => ({
  path: `assets/minecraft/textures/block/${name}.png`,
  name,
  beforePng: PNG,
  afterPng: PNG,
  changedPixels: 4
})

function mountIn(component: unknown, props: Record<string, unknown>): VueWrapper {
  const pinia = createPinia()
  setActivePinia(pinia)
  const Host = defineComponent({
    setup: () => () => h(NMessageProvider, () => h(component as never, props))
  })
  return mount(Host, { global: { plugins: [pinia, createAppI18n()] }, attachTo: document.body })
}

describe('BulkReview', () => {
  it('toggles textures and steps; apply emits the kept ones', async () => {
    const steps = [
      {
        id: 's1',
        callId: 'c1',
        tool: 'hue_shift',
        args: { degrees: 30 },
        kind: 'mutate',
        description: { key: 'ops.hueShift', params: { degrees: '+30' } },
        dependsOn: [],
        targets: ['a', 'b', 'c']
      }
    ] as ProposalStep[]
    const events: unknown[] = []
    const wrapper = mountIn(BulkReview, {
      items: [item('stone'), item('dirt'), item('sand')],
      steps,
      onApply: (sel: unknown) => events.push(sel)
    })
    await flushPromises()
    expect(wrapper.text()).toContain('3 textures change')
    expect(wrapper.text()).toContain('3 textures')
    await wrapper.find('[data-testid="bulk-item-dirt"]').trigger('click')
    expect(wrapper.text()).toContain('2 of 3 kept')
    await wrapper.find('[data-testid="bulk-apply"]').trigger('click')
    expect(events).toEqual([
      {
        stepIds: ['s1'],
        paths: [item('stone').path, item('sand').path]
      }
    ])
    await wrapper.find('[data-testid="bulk-none"]').trigger('click')
    expect(wrapper.find('[data-testid="bulk-apply"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})

describe('BulkDialog', () => {
  beforeEach(() => {
    fakeBridge.calls = []
    fakeBridge.bulkPreview = {
      id: 'prev1',
      packId: 'p1',
      operations: [],
      items: [item('stone'), item('dirt')],
      unchanged: ['x'],
      failed: []
    }
  })

  it('previews the chosen operation on the selection, then applies the kept textures', async () => {
    const applied: number[] = []
    const wrapper = mountIn(BulkDialog, {
      packId: 'p1',
      paths: [item('stone').path, item('dirt').path],
      show: true,
      onApplied: (n: number) => applied.push(n)
    })
    await flushPromises()
    ;(document.querySelector('[data-testid="bulk-preview"]') as HTMLButtonElement).click()
    await flushPromises()
    const preview = fakeBridge.calls.find((c) => c.channel === 'bulk.preview')
    expect(preview?.payload).toEqual({
      packId: 'p1',
      paths: [item('stone').path, item('dirt').path],
      operations: [{ tool: 'hue_shift', args: { degrees: 30 } }]
    })
    expect(document.body.textContent).toContain('1 texture is unchanged.')
    ;(document.querySelector('[data-testid="bulk-apply"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(fakeBridge.calls.find((c) => c.channel === 'bulk.apply')?.payload).toEqual({
      previewId: 'prev1',
      paths: [item('stone').path, item('dirt').path]
    })
    expect(applied).toEqual([2])
    wrapper.unmount()
  })
})
