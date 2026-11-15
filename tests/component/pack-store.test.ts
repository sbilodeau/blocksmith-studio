import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ALL_CATEGORIES, disposePackStore, usePackStore } from '@renderer/stores/pack'
import { fakeBridge } from './setup'
import { CATEGORIES, TEXTURES, pack } from './fixtures'

describe('per-pack store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    fakeBridge.packs = [pack()]
    fakeBridge.textures = TEXTURES
    fakeBridge.categories = CATEGORIES
  })

  it('loads summary, textures and categories', async () => {
    const store = usePackStore('fire')
    await store.load()
    expect(store.summary?.name).toBe('Fire pack')
    expect(store.textures).toHaveLength(5)
    expect(store.changedCount).toBe(2)
  })

  it('filters by category, status and search', async () => {
    const store = usePackStore('fire')
    await store.load()
    store.openCategory('blocks')
    expect(store.visible.map((t) => t.name)).toEqual(['stone', 'dirt', 'diamond_ore'])
    store.statusFilter = 'changed'
    expect(store.visible.map((t) => t.name)).toEqual(['stone'])
    store.statusFilter = 'all'
    store.openCategory(ALL_CATEGORIES)
    store.search = 'diamond'
    expect(store.visible.map((t) => t.name)).toEqual(['diamond_ore', 'diamond_sword'])
  })

  it('supports single, toggle and range selection', async () => {
    const store = usePackStore('fire')
    await store.load()
    store.openCategory(ALL_CATEGORIES)
    const paths = store.visible.map((t) => t.path)
    store.select(paths[0], 'single')
    store.select(paths[3], 'range')
    expect([...store.selection]).toEqual(paths.slice(0, 4))
    store.select(paths[1], 'toggle')
    expect(store.selection.has(paths[1])).toBe(false)
    store.select(paths[4], 'single')
    expect([...store.selection]).toEqual([paths[4]])
    store.selectAll()
    expect(store.selection.size).toBe(5)
    store.clearSelection()
    expect(store.selection.size).toBe(0)
  })

  it('keeps separate state per pack and disposes it', async () => {
    fakeBridge.packs = [pack(), pack({ id: 'ice', name: 'Ice pack' })]
    const fire = usePackStore('fire')
    const ice = usePackStore('ice')
    fire.search = 'stone'
    expect(ice.search).toBe('')
    disposePackStore('fire')
    expect(usePackStore('fire').search).toBe('')
  })
})
