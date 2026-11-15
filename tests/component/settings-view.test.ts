import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NMessageProvider } from 'naive-ui'
import SettingsView from '@renderer/views/SettingsView.vue'
import { createAppI18n } from '@renderer/i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import { useUpdaterStore } from '@renderer/stores/updater'
import { defaultSettings } from '@shared/model/settings'
import { fakeBridge } from './setup'

// Mirrors App.vue: keeps the i18n locale in sync with the settings store.
const Host = defineComponent({
  setup() {
    const { locale } = useI18n()
    const store = useSettingsStore()
    watch(
      () => store.settings.language,
      (l) => (locale.value = l),
      { immediate: true }
    )
    return () => h(NMessageProvider, () => h(SettingsView))
  }
})

async function mountSettings(): Promise<ReturnType<typeof mount>> {
  const pinia = createPinia()
  setActivePinia(pinia)
  await useSettingsStore().load()
  await useUpdaterStore().init()
  const wrapper = mount(Host, { global: { plugins: [pinia, createAppI18n()] } })
  await flushPromises()
  return wrapper
}

describe('SettingsView', () => {
  beforeEach(() => {
    fakeBridge.settings = defaultSettings()
    fakeBridge.calls = []
  })

  it('renders in English by default', async () => {
    const wrapper = await mountSettings()
    expect(wrapper.text()).toContain('Settings')
    expect(wrapper.text()).toContain('Updates are disabled in development builds.')
    expect(wrapper.find('[data-testid="app-version"]').text()).toBe('26.46.0')
  })

  it('switches the interface to French through the settings store', async () => {
    const wrapper = await mountSettings()
    await useSettingsStore().update({ language: 'fr' })
    await flushPromises()
    expect(fakeBridge.calls.some((c) => c.channel === 'settings.update')).toBe(true)
    expect(wrapper.text()).toContain('Paramètres')
    expect(wrapper.text()).toContain('Mises à jour')
  })

  it('updates the theme when a theme button is clicked', async () => {
    const wrapper = await mountSettings()
    await wrapper.find('[data-testid="theme-dark"] input').setValue(true)
    await flushPromises()
    expect(fakeBridge.settings.theme).toBe('dark')
  })
})
