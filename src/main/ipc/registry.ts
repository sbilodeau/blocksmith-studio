import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { InvokeChannel, EventChannel } from '@shared/ipc/channels'
import {
  inputSchemas,
  type AppError,
  type EventPayload,
  type InvokeOutput,
  type Result
} from '@shared/ipc/contract'
import type { z } from 'zod'

/** Thrown by handlers to return a typed, i18n-keyed error to the renderer. */
export class AppErrorException extends Error {
  constructor(
    public readonly code: string,
    public readonly params?: Record<string, string | number>
  ) {
    super(code)
  }
}

type Handler<C extends InvokeChannel> = (
  input: z.output<(typeof inputSchemas)[C]>,
  event: IpcMainInvokeEvent
) => Promise<InvokeOutput<C>> | InvokeOutput<C>

/**
 * Only frames loaded from the app itself may call IPC: the packaged file:// renderer, or the
 * electron-vite dev server in development.
 */
export function isTrustedSender(frameUrl: string | undefined, devServerUrl?: string): boolean {
  if (!frameUrl) return false
  if (frameUrl.startsWith('file://')) return true
  if (devServerUrl) {
    try {
      return new URL(frameUrl).origin === new URL(devServerUrl).origin
    } catch {
      return false
    }
  }
  return false
}

export function handle<C extends InvokeChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, async (event, payload: unknown): Promise<Result<InvokeOutput<C>>> => {
    if (!isTrustedSender(event.senderFrame?.url, process.env['ELECTRON_RENDERER_URL'])) {
      return { ok: false, error: { code: 'ipc.untrustedSender' } }
    }
    const parsed = inputSchemas[channel].safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: { code: 'ipc.invalidInput', params: { channel } } }
    }
    try {
      const value = await handler(parsed.data as z.output<(typeof inputSchemas)[C]>, event)
      return { ok: true, value }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppErrorException) return { code: err.code, params: err.params }
  console.error('[ipc] unexpected error', err)
  return { code: 'unexpected' }
}

export function send<E extends EventChannel>(
  target: WebContents | undefined | null,
  channel: E,
  payload: EventPayload<E>
): void {
  if (target && !target.isDestroyed()) target.send(channel, payload)
}
