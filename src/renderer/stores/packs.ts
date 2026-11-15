import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CreatePackInput, ImportReport, PackSummary } from '@shared/model/pack'
import { call } from '../services/ipc'
import { useJobsStore } from './jobs'

/** The workspace's pack list (pack selector). */
export const usePacksStore = defineStore('packs', () => {
  const packs = ref<PackSummary[]>([])
  const workspacePath = ref('')
  const loading = ref(false)
  let listening = false

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      const [list, ws] = await Promise.all([call('packs.list'), call('workspace.get')])
      packs.value = list
      workspacePath.value = ws.path
    } finally {
      loading.value = false
    }
  }

  function init(): void {
    if (listening) return
    listening = true
    window.blocksmith.on('packs.changed', () => void refresh())
  }

  async function create(input: CreatePackInput): Promise<PackSummary> {
    const pack = await call('packs.create', input)
    await refresh()
    return pack
  }

  async function importZip(): Promise<ImportReport | null> {
    try {
      const report = await call('packs.import')
      if (report) await refresh()
      return report
    } finally {
      useJobsStore().clear('packs.import')
    }
  }

  async function remove(packId: string): Promise<void> {
    await call('packs.delete', { packId })
    await refresh()
  }

  async function reveal(packId: string): Promise<void> {
    await call('packs.reveal', { packId })
  }

  async function chooseWorkspace(): Promise<void> {
    const chosen = await call('workspace.choose')
    if (chosen) await refresh()
  }

  function find(packId: string): PackSummary | undefined {
    return packs.value.find((p) => p.id === packId)
  }

  return {
    packs,
    workspacePath,
    loading,
    init,
    refresh,
    create,
    importZip,
    remove,
    reveal,
    chooseWorkspace,
    find
  }
})
