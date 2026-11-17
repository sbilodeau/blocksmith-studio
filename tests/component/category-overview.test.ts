import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CategoryOverview from '@renderer/components/pack/CategoryOverview.vue'
import { createAppI18n } from '@renderer/i18n'

describe('CategoryOverview', () => {
  it('opens a category with the mouse or the keyboard', async () => {
    const w = mount(CategoryOverview, {
      props: {
        categories: [{ id: 'blocks', i18nKey: 'category.blocks', count: 3, changedCount: 0 }]
      },
      global: { plugins: [createAppI18n()] }
    })
    const card = w.find('[data-testid="overview-blocks"]')
    expect(card.attributes('role')).toBe('button')
    expect(card.attributes('tabindex')).toBe('0')
    await card.trigger('click')
    await card.trigger('keydown', { key: 'Enter' })
    await card.trigger('keydown', { key: ' ' })
    expect(w.emitted('open')).toEqual([['blocks'], ['blocks'], ['blocks']])
  })
})
