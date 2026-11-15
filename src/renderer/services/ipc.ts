import { isProxy, toRaw } from 'vue'
import type { InvokeChannel } from '@shared/ipc/channels'
import type { AppError, InvokeInput, InvokeOutput } from '@shared/ipc/contract'

/** Error carrying the typed AppError from main; `code` maps to the i18n key `errors.<code>`. */
export class IpcError extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.code)
  }
}

/**
 * Copies a payload into plain data: Vue reactive proxies (refs, store state) cannot cross the structured clone
 * used by IPC ("An object could not be cloned"). Typed arrays are kept as they are.
 */
export function toPlain<T>(value: T): T {
  const v: unknown = isProxy(value) ? toRaw(value) : value
  if (v === null || typeof v !== 'object') return v as T
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer || v instanceof Date) return v as T
  if (Array.isArray(v)) return v.map((x) => toPlain(x)) as T
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = toPlain(x)
  return out as T
}

/** Invokes a main-process channel and unwraps the Result, throwing IpcError on failure. */
export async function call<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeInput<C> extends undefined ? [] : [InvokeInput<C>]
): Promise<InvokeOutput<C>> {
  const payload = args.map((a) => toPlain(a)) as typeof args
  const result = await window.blocksmith.invoke(channel, ...payload)
  if (!result.ok) throw new IpcError(result.error)
  return result.value
}
