import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ProposalReview from '@renderer/components/ai/ProposalReview.vue'
import { createAppI18n } from '@renderer/i18n'
import { encodePng, createImage } from '@shared/image'
import type { Proposal } from '@shared/ai/types'

const png = new Uint8Array(encodePng(createImage(2, 2, [255, 0, 0, 255])))

function proposal(): Proposal {
  return {
    id: 'p1',
    runId: 'r1',
    agent: 'editor',
    packId: 'fire',
    texturePath: 'assets/minecraft/textures/block/stone.png',
    basePng: png,
    status: 'pending',
    steps: [
      {
        id: 's1',
        callId: 'c1',
        tool: 'rotate',
        args: { degrees: 90, direction: 'counterclockwise' },
        kind: 'mutate',
        description: { key: 'ops.unknown.rotate', params: {} },
        dependsOn: [],
        previewPng: png
      },
      {
        id: 's2',
        callId: 'c2',
        tool: 'set_pixels',
        args: {},
        kind: 'mutate',
        description: { key: 'ops.unknown.set', params: {} },
        dependsOn: ['s1'],
        previewPng: png
      }
    ]
  }
}

describe('ProposalReview', () => {
  it('applies every step by default and a subset when unchecked, warning about dependencies', async () => {
    const wrapper = mount(ProposalReview, {
      props: { proposal: proposal() },
      global: { plugins: [createAppI18n()] }
    })
    expect(wrapper.text()).toContain('Proposed plan (2 steps)')
    await wrapper.find('[data-testid="proposal-apply"]').trigger('click')
    expect(wrapper.emitted('apply')?.[0]).toEqual([['s1', 's2']])

    // Uncheck the first step: the second depends on it -> warning, partial apply.
    const box = wrapper.findAll('.n-checkbox')[0]
    await box.trigger('click')
    expect(wrapper.text()).toContain('computed on top of a step you unchecked')
    await wrapper.find('[data-testid="proposal-apply"]').trigger('click')
    expect(wrapper.emitted('apply')?.[1]).toEqual([['s2']])
  })

  it('emits reject and hides actions once resolved', async () => {
    const wrapper = mount(ProposalReview, {
      props: { proposal: proposal() },
      global: { plugins: [createAppI18n()] }
    })
    await wrapper.find('[data-testid="proposal-reject"]').trigger('click')
    expect(wrapper.emitted('reject')).toHaveLength(1)
    await wrapper.setProps({ proposal: { ...proposal(), status: 'rejected' } })
    expect(wrapper.find('[data-testid="proposal-apply"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Rejected')
  })
})

describe('ProposalReview descriptions', () => {
  it('localizes step descriptions and enum values in both languages', () => {
    const p = proposal()
    p.steps[0]!.description = {
      key: 'ops.rotate',
      params: { degrees: 90, direction: 'counterclockwise' }
    }
    const fr = createAppI18n('fr')
    const wrapperFr = mount(ProposalReview, {
      props: { proposal: p },
      global: { plugins: [fr] }
    })
    expect(wrapperFr.text()).toContain('Rotation 90° antihoraire')
    const wrapperEn = mount(ProposalReview, {
      props: { proposal: p },
      global: { plugins: [createAppI18n()] }
    })
    expect(wrapperEn.text()).toContain('Rotate 90° counterclockwise')
  })
})
