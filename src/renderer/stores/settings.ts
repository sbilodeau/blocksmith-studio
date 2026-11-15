import { defineStore } from 'pinia'
import { ref } from 'vue'
import { defaultSettings, type Settings, type SettingsPatch } from '@shared/model/settings'
import { call } from '../services/ipc'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>(defaultSettings())
  const loaded = ref(false)

  async function load(): Promise<void> {
    settings.value = await call('settings.get')
    loaded.value = true
    window.blocksmith.on('settings.changed', (next) => {
      settings.value = next
    })
  }

  async function update(patch: SettingsPatch): Promise<void> {
    settings.value = await call('settings.update', patch)
  }

  return { settings, loaded, load, update }
})
