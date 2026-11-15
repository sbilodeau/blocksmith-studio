import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { NDialogProvider, NMessageProvider } from 'naive-ui'
import HomeView from '@renderer/views/HomeView.vue'
import { createAppI18n } from '@renderer/i18n'
import { routes } from '@renderer/router'
import { useTabsStore } from '@renderer/stores/tabs'
import { fakeBridge } from './setup'
import { pack } from './fixtures'

const Host = defineComponent({
  setup: () => () => h(NMessageProvider, () => h(NDialogProvider, () => h(HomeView)))
})

async function mountHome(): Promise<ReturnType<typeof mount>> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const wrapper = mount(Host, { global: { plugins: [pinia, createAppI18n(), router] } })
  await flushPromises()
  return wrapper
}

describe('HomeView (pack selector)', () => {
  beforeEach(() => {
    fakeBridge.packs = []
  })

  it('shows the empty state and the workspace path', async () => {
    const wrapper = await mountHome()
    expect(wrapper.find('[data-testid="home-empty"]').text()).toContain('No packs yet')
    expect(wrapper.find('[data-testid="workspace-path"]').text()).toContain('Blocksmith Studio')
  })

  it('lists packs with their version and changed count', async () => {
    fakeBridge.packs = [pack(), pack({ id: 'ice', name: 'Ice pack', changedCount: 0 })]
    const wrapper = await mountHome()
    const text = wrapper.find('[data-testid="pack-list"]').text()
    expect(text).toContain('Fire pack')
    expect(text).toContain('Ice pack')
    expect(text).toContain('Minecraft 26.3')
    expect(text).toContain('3 changed files')
    expect(text).toContain('no changed files')
  })

  it('opens a pack in its own tab', async () => {
    fakeBridge.packs = [pack()]
    const wrapper = await mountHome()
    await wrapper.find('[data-testid="pack-open-fire"]').trigger('click')
    await flushPromises()
    const tabs = useTabsStore()
    expect(tabs.tabs.map((t) => t.id)).toEqual(['home', 'fire'])
    expect(tabs.activeId).toBe('fire')
  })
})
