import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTabsStore, HOME_TAB_ID } from '@renderer/stores/tabs'

describe('tabs store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('always has a non-closable home tab', () => {
    const tabs = useTabsStore()
    expect(tabs.tabs).toHaveLength(1)
    expect(tabs.active.id).toBe(HOME_TAB_ID)
    tabs.close(HOME_TAB_ID)
    expect(tabs.tabs).toHaveLength(1)
  })

  it('opens one tab per pack and does not duplicate', () => {
    const tabs = useTabsStore()
    tabs.open({ id: 'pack-a', kind: 'pack', label: 'Fire', closable: true })
    tabs.open({ id: 'pack-b', kind: 'pack', label: 'Ice', closable: true })
    tabs.open({ id: 'pack-a', kind: 'pack', label: 'Fire', closable: true })
    expect(tabs.tabs.map((t) => t.id)).toEqual([HOME_TAB_ID, 'pack-a', 'pack-b'])
    expect(tabs.activeId).toBe('pack-a')
  })

  it('activates the previous tab when closing the active one', () => {
    const tabs = useTabsStore()
    tabs.open({ id: 'pack-a', kind: 'pack', label: 'Fire', closable: true })
    tabs.open({ id: 'pack-b', kind: 'pack', label: 'Ice', closable: true })
    tabs.close('pack-b')
    expect(tabs.activeId).toBe('pack-a')
  })
})
