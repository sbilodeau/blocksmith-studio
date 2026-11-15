import { z } from 'zod'
import type { InvokeChannel, EventChannel } from './channels'
import { SettingsPatchSchema, type Settings } from '../model/settings'
import type { UpdaterStatus } from '../model/updater'

/** Typed, i18n-keyed error returned across IPC (message key: `errors.<code>`). */
export interface AppError {
  code: string
  params?: Record<string, string | number>
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform | string
  arch: string
  electron: string
  chrome: string
  node: string
  isPackaged: boolean
}

const NoInput = z.undefined()

/** Runtime input validation for every invoke channel. Main validates each payload against this. */
export const inputSchemas = {
  'app.getInfo': NoInput,
  'app.openExternal': z.object({ url: z.url({ protocol: /^https$/ }) }).strict(),
  'settings.get': NoInput,
  'settings.update': SettingsPatchSchema,
  'updater.getStatus': NoInput,
  'updater.check': NoInput,
  'updater.download': NoInput,
  'updater.install': NoInput
} satisfies Record<InvokeChannel, z.ZodType>

/** Output types (compile-time only; main is trusted). */
export interface InvokeOutputs {
  'app.getInfo': AppInfo
  'app.openExternal': void
  'settings.get': Settings
  'settings.update': Settings
  'updater.getStatus': UpdaterStatus
  'updater.check': UpdaterStatus
  'updater.download': UpdaterStatus
  'updater.install': void
}

export type InvokeInput<C extends InvokeChannel> = z.input<(typeof inputSchemas)[C]>
export type InvokeOutput<C extends InvokeChannel> = InvokeOutputs[C]

export interface EventPayloads {
  'settings.changed': Settings
  'updater.status': UpdaterStatus
}

export type EventPayload<E extends EventChannel> = EventPayloads[E]

/** The API exposed on `window.blocksmith` by the preload script. */
export interface BlocksmithApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeInput<C> extends undefined ? [] : [InvokeInput<C>]
  ): Promise<Result<InvokeOutput<C>>>
  on<E extends EventChannel>(channel: E, listener: (payload: EventPayload<E>) => void): () => void
}
