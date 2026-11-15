import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { disposePackStore } from './pack'

/**
 * Workspace tabs. The "home" tab (pack selector) is always present; from M1 on, each open pack gets its own
 * tab (1 tab = 1 pack) backed by its own per-pack store.
 */
export interface TabDescriptor {
  id: string
  kind: 'home' | 'pack'
  /** i18n key for fixed tabs, or a literal pack name for pack tabs. */
  labelKey?: string
  label?: string
  closable: boolean
}

export const HOME_TAB_ID = 'home'

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<TabDescriptor[]>([
    { id: HOME_TAB_ID, kind: 'home', labelKey: 'nav.home', closable: false }
  ])
  const activeId = ref<string>(HOME_TAB_ID)

  const active = computed(() => tabs.value.find((t) => t.id === activeId.value) ?? tabs.value[0])

  function activate(id: string): void {
    if (tabs.value.some((t) => t.id === id)) activeId.value = id
  }

  function open(tab: TabDescriptor): void {
    if (!tabs.value.some((t) => t.id === tab.id)) tabs.value.push(tab)
    activeId.value = tab.id
  }

  function close(id: string): void {
    const index = tabs.value.findIndex((t) => t.id === id)
    if (index < 0 || !tabs.value[index].closable) return
    const [removed] = tabs.value.splice(index, 1)
    if (removed.kind === 'pack') disposePackStore(removed.id)
    if (activeId.value === id) activeId.value = tabs.value[Math.max(0, index - 1)].id
  }

  function openPack(packId: string, name: string): void {
    open({ id: packId, kind: 'pack', label: name, closable: true })
  }

  function rename(id: string, label: string): void {
    const tab = tabs.value.find((t) => t.id === id)
    if (tab) tab.label = label
  }

  return { tabs, activeId, active, activate, open, openPack, close, rename }
})
