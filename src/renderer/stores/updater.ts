import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UpdaterStatus } from '@shared/model/updater'
import { call } from '../services/ipc'

export const useUpdaterStore = defineStore('updater', () => {
  const status = ref<UpdaterStatus>({ state: 'idle' })

  async function init(): Promise<void> {
    status.value = await call('updater.getStatus')
    window.blocksmith.on('updater.status', (next) => {
      status.value = next
    })
  }

  async function check(): Promise<void> {
    status.value = await call('updater.check')
  }

  async function download(): Promise<void> {
    status.value = await call('updater.download')
  }

  async function install(): Promise<void> {
    await call('updater.install')
  }

  return { status, init, check, download, install }
})
