import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { isEventChannel, isInvokeChannel } from '@shared/ipc/channels'
import type { BlocksmithApi } from '@shared/ipc/contract'

/**
 * The ONLY bridge between renderer and main. No generic ipcRenderer access, no Node APIs:
 * channels are whitelisted in shared/ipc/channels.ts and payloads are validated again in main.
 */
const api: BlocksmithApi = {
  invoke(channel: string, ...args: unknown[]) {
    if (!isInvokeChannel(channel)) {
      return Promise.resolve({ ok: false, error: { code: 'ipc.unknownChannel' } })
    }
    return ipcRenderer.invoke(channel, args[0])
  },
  on(channel: string, listener: (payload: unknown) => void) {
    if (!isEventChannel(channel)) throw new Error(`Unknown event channel: ${channel}`)
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }
} as unknown as BlocksmithApi

contextBridge.exposeInMainWorld('blocksmith', api)
