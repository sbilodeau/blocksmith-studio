/**
 * IPC channel names. Kept free of runtime dependencies so the sandboxed preload can import it cheaply.
 * Every channel the renderer may use MUST be listed here; the preload rejects anything else.
 */

/** Request/response channels (renderer -> main, via ipcRenderer.invoke). */
export const INVOKE_CHANNELS = [
  'app.getInfo',
  'app.openExternal',
  'settings.get',
  'settings.update',
  'updater.getStatus',
  'updater.check',
  'updater.download',
  'updater.install'
] as const

/** Event channels (main -> renderer, via webContents.send). */
export const EVENT_CHANNELS = ['settings.changed', 'updater.status'] as const

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]
export type EventChannel = (typeof EVENT_CHANNELS)[number]

export function isInvokeChannel(value: unknown): value is InvokeChannel {
  return typeof value === 'string' && (INVOKE_CHANNELS as readonly string[]).includes(value)
}

export function isEventChannel(value: unknown): value is EventChannel {
  return typeof value === 'string' && (EVENT_CHANNELS as readonly string[]).includes(value)
}
