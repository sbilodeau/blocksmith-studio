import type { InvokeChannel } from '@shared/ipc/channels'
import type { AppError, InvokeInput, InvokeOutput } from '@shared/ipc/contract'

/** Error carrying the typed AppError from main; `code` maps to the i18n key `errors.<code>`. */
export class IpcError extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.code)
  }
}

/** Invokes a main-process channel and unwraps the Result, throwing IpcError on failure. */
export async function call<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeInput<C> extends undefined ? [] : [InvokeInput<C>]
): Promise<InvokeOutput<C>> {
  const result = await window.blocksmith.invoke(channel, ...args)
  if (!result.ok) throw new IpcError(result.error)
  return result.value
}
