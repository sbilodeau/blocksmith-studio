import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CATEGORY_RULES } from '@shared/categories'
import { inputSchemas } from '@shared/ipc/contract'

const handlers = new Map<string, (input: unknown) => unknown>()

vi.mock('../../src/main/ipc/registry', () => ({
  handle: (channel: string, fn: (input: unknown) => unknown) => handlers.set(channel, fn)
}))

const { registerCategoryHandlers } = await import('../../src/main/ipc/category-handlers')

describe('registerCategoryHandlers', () => {
  const state = { rules: [...DEFAULT_CATEGORY_RULES], customized: true }
  const store = {
    state: vi.fn(() => state),
    save: vi.fn(async () => state),
    reset: vi.fn(async () => ({ ...state, customized: false }))
  }
  const packs = {
    categoryOverrides: vi.fn(async () => []),
    setCategoryOverrides: vi.fn(async () => [])
  }
  const notifyAllPacks = vi.fn()

  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    registerCategoryHandlers({ store, packs, notifyAllPacks })
  })

  it('registers the category channels', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'categories.get',
      'categories.reset',
      'categories.save',
      'pack.categoryOverrides',
      'pack.setCategoryOverrides'
    ])
  })

  it('save and reset refresh every open pack', async () => {
    expect(handlers.get('categories.get')!(undefined)).toBe(state)
    await handlers.get('categories.save')!({ rules: state.rules })
    expect(store.save).toHaveBeenCalledWith(state.rules)
    expect(notifyAllPacks).toHaveBeenCalledTimes(1)
    await handlers.get('categories.reset')!(undefined)
    expect(notifyAllPacks).toHaveBeenCalledTimes(2)
  })

  it('pack channels go to the pack service', async () => {
    await handlers.get('pack.categoryOverrides')!({ packId: 'p' })
    expect(packs.categoryOverrides).toHaveBeenCalledWith('p')
    await handlers.get('pack.setCategoryOverrides')!({ packId: 'p', overrides: [] })
    expect(packs.setCategoryOverrides).toHaveBeenCalledWith('p', [])
  })
})

describe('category channel input schemas', () => {
  it('accept rule lists and refuse malformed ones', () => {
    const save = inputSchemas['categories.save']
    expect(save.safeParse({ rules: DEFAULT_CATEGORY_RULES }).success).toBe(true)
    expect(save.safeParse({ rules: [{ id: 'x', icon: '', include: [], order: 1 }] }).success).toBe(
      false
    )
    expect(save.safeParse({ rules: [], extra: 1 }).success).toBe(false)
    const pack = inputSchemas['pack.setCategoryOverrides']
    expect(
      pack.safeParse({
        packId: 'p',
        overrides: [{ id: 'mine', label: 'Mine', icon: '', include: ['a/**'], order: 1 }]
      }).success
    ).toBe(true)
    expect(pack.safeParse({ packId: 'p', overrides: [{ id: 'BAD' }] }).success).toBe(false)
  })
})
