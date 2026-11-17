import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { NDialogProvider, NMessageProvider } from 'naive-ui'
import type { TextureEntry } from '@shared/model/pack'
import TextureGrid from '@renderer/components/pack/TextureGrid.vue'
import { ALL_CATEGORIES, usePackStore } from '@renderer/stores/pack'
import { createAppI18n } from '@renderer/i18n'
import { texture } from './fixtures'

/** 10,000 textures, as in a huge pack. */
const MANY: TextureEntry[] = Array.from({ length: 10_000 }, (_, i) =>
  texture(
    `assets/minecraft/textures/block/tex_${String(i).padStart(5, '0')}.png`,
    i % 3 === 0 ? 'modified' : 'vanilla',
    ['blocks']
  )
)

let wrapper: VueWrapper | null = null

function mountGrid(): VueWrapper {
  const Host = defineComponent({
    setup: () => () =>
      h(NMessageProvider, () => h(NDialogProvider, () => h(TextureGrid, { packId: 'big' })))
  })
  wrapper = mount(Host, { global: { plugins: [createAppI18n()] }, attachTo: document.body })
  return wrapper
}

const tiles = (w: VueWrapper): HTMLElement[] =>
  w.findAll('[data-path]').map((t) => t.element as HTMLElement)

const scroller = (w: VueWrapper): HTMLElement =>
  w.find('[data-testid="texture-grid"]').element as HTMLElement

describe('TextureGrid (virtual)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = usePackStore('big')
    store.textures = MANY
    store.openCategory(ALL_CATEGORIES)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('renders a bounded number of tiles for 10,000 textures', async () => {
    const w = mountGrid()
    await flushPromises()
    const rendered = tiles(w)
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(300)
    expect(rendered[0].dataset['path']).toBe(MANY[0].path)
    expect(rendered[0].dataset['testid']).toBe('tile-tex_00000')
    expect(rendered[0].dataset['status']).toBe('modified')
    expect(w.find('[data-testid="grid-count"]').text()).toContain('10000 of 10000')
  })

  it('renders the rows under the scroll position', async () => {
    const w = mountGrid()
    await flushPromises()
    scroller(w).scrollTop = 50_000
    await w.find('[data-testid="texture-grid"]').trigger('scroll')
    const rendered = tiles(w)
    expect(rendered.length).toBeLessThan(300)
    const first = MANY.findIndex((t) => t.path === rendered[0].dataset['path'])
    expect(first).toBeGreaterThan(1000)
  })

  it('selects with click, shift-click, Ctrl+A and Escape', async () => {
    const w = mountGrid()
    await flushPromises()
    const store = usePackStore('big')
    await w.find('[data-testid="tile-tex_00002"]').trigger('click')
    await w.find('[data-testid="tile-tex_00010"]').trigger('click', { shiftKey: true })
    expect(store.selection.size).toBe(9)
    expect(w.find('[data-testid="selection-bar"]').text()).toContain('9 textures selected')
    expect(w.findAll('.tile.selected')).toHaveLength(9)

    const grid = w.find('[data-testid="texture-grid"]')
    await grid.trigger('keydown', { key: 'a', ctrlKey: true })
    expect(store.selection.size).toBe(10_000)
    expect(store.selectedPaths).toHaveLength(10_000)
    await grid.trigger('keydown', { key: 'Escape' })
    expect(store.selection.size).toBe(0)
    expect(w.find('[data-testid="selection-bar"]').exists()).toBe(false)
  })

  it('brings the last edited tile into view on return from the editor', async () => {
    const store = usePackStore('big')
    store.lastEdited = MANY[7000].path
    const w = mountGrid()
    await flushPromises()
    expect(store.lastEdited).toBeNull()
    expect(w.find(`[data-path="${MANY[7000].path}"]`).exists()).toBe(true)
    expect(scroller(w).scrollTop).toBeGreaterThan(0)
  })

  it('keeps the scroll position across unmount and mount', async () => {
    const store = usePackStore('big')
    let w = mountGrid()
    await flushPromises()
    scroller(w).scrollTop = 12_345
    w.unmount()
    wrapper = null
    expect(store.gridScroll).toBe(12_345)
    w = mountGrid()
    await flushPromises()
    expect(scroller(w).scrollTop).toBe(12_345)
    expect(tiles(w)[0].dataset['path']).not.toBe(MANY[0].path)
  })
})
