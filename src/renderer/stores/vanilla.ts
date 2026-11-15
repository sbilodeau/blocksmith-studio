import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { MinecraftInstall, VanillaAvailability } from '@shared/model/vanilla'
import { call } from '../services/ipc'
import { useJobsStore } from './jobs'

/** Minecraft installs and per-version availability of vanilla assets. */
export const useVanillaStore = defineStore('vanilla', () => {
  const installs = ref<MinecraftInstall[]>([])
  const versions = ref<VanillaAvailability[]>([])
  const preparing = ref<string | null>(null)
  const loaded = ref(false)

  const latest = computed(() => versions.value.find((v) => v.isLatest) ?? versions.value[0])
  const readyVersions = computed(() => versions.value.filter((v) => v.state === 'ready'))

  async function refresh(): Promise<void> {
    const [i, v] = await Promise.all([call('minecraft.detect'), call('vanilla.availability')])
    installs.value = i
    versions.value = v
    loaded.value = true
  }

  async function addPath(): Promise<MinecraftInstall | null> {
    const added = await call('minecraft.addPath')
    if (added) await refresh()
    return added
  }

  async function prepare(versionId: string): Promise<void> {
    preparing.value = versionId
    try {
      const updated = await call('vanilla.prepare', { versionId })
      versions.value = versions.value.map((v) => (v.versionId === versionId ? updated : v))
    } finally {
      preparing.value = null
      useJobsStore().clear('vanilla.prepare')
    }
  }

  function find(versionId: string): VanillaAvailability | undefined {
    return versions.value.find((v) => v.versionId === versionId)
  }

  return {
    installs,
    versions,
    preparing,
    loaded,
    latest,
    readyVersions,
    refresh,
    addPath,
    prepare,
    find
  }
})
