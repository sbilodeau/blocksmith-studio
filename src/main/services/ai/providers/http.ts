import { AppErrorException } from '../../../ipc/registry'

/** `fetch`-compatible function (Electron `net.fetch` in the app, a local server or a fake in tests). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ProviderLogger {
  warn(message?: unknown, ...rest: unknown[]): void
}

/** Sleeps `ms`, rejecting early when `signal` aborts. Injected in tests to skip backoff delays. */
export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>

export const defaultSleep: SleepFn = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** True for http(s)://localhost, 127.0.0.1 and [::1] (self-hosted Ollama, local tests). */
export function isLoopbackUrl(baseUrl: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(baseUrl).hostname)
  } catch {
    return false
  }
}

/**
 * Validates a provider base URL: https, or plain http on a loopback host only. No credentials, query or
 * fragment (the key goes in the Authorization header, never in the URL). Returns the normalized URL.
 */
export function assertSafeBaseUrl(baseUrl: string): URL {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new AppErrorException('ai.insecureBaseUrl')
  }
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
  if (!secure || url.username || url.password || url.search || url.hash) {
    throw new AppErrorException('ai.insecureBaseUrl')
  }
  return url
}

/** Joins an API path onto the base URL and checks the result stays on the same origin. */
export function joinUrl(base: URL, path: string): string {
  const prefix = base.pathname.replace(/\/+$/, '')
  const target = new URL(`${base.origin}${prefix}${path.startsWith('/') ? path : `/${path}`}`)
  if (target.origin !== base.origin) throw new AppErrorException('ai.insecureBaseUrl')
  return target.toString()
}

/** Replaces every occurrence of a secret in a string (logged or user-visible text). */
export function redact(text: string, secret: string | undefined): string {
  if (!secret) return text
  return text.split(secret).join('***')
}

/** Copy of request headers that is safe to log. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    out[name] = /^(authorization|proxy-authorization|x-api-key|api-key)$/i.test(name)
      ? '***'
      : value
  }
  return out
}

/** Header names an extra header may not override. */
const RESERVED_HEADERS = /^(authorization|host|content-length|content-type|cookie)$/i
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** Validates user extra headers (OpenRouter `HTTP-Referer`...). Throws 'ai.invalidHeader' {name}. */
export function assertValidExtraHeaders(headers: Record<string, string> | undefined): void {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!HEADER_NAME.test(name) || RESERVED_HEADERS.test(name) || /[\r\n\0]/.test(value)) {
      throw new AppErrorException('ai.invalidHeader', { name: name.slice(0, 60) })
    }
  }
}

/** Maps an aborted signal to 'ai.timeout' (AbortSignal.timeout) or 'ai.aborted' (Stop button). */
export function abortError(signal: AbortSignal): AppErrorException {
  const reason = signal.reason as { name?: string } | undefined
  return new AppErrorException(reason?.name === 'TimeoutError' ? 'ai.timeout' : 'ai.aborted')
}

/** Parses `Retry-After` (seconds or HTTP date) into whole seconds. */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now()
): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.ceil(Number(trimmed))
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, Math.ceil((date - now) / 1000))
}

const MAX_ERROR_MESSAGE = 300

/** Reads the provider's error message (`{ error: string }` or `{ error: { message } }`), truncated. */
async function readErrorMessage(response: Response, secret?: string): Promise<string | undefined> {
  try {
    const text = await response.text()
    let message: string | undefined
    try {
      const body = JSON.parse(text) as { error?: unknown; message?: unknown }
      if (typeof body.error === 'string') message = body.error
      else if (body.error && typeof (body.error as { message?: unknown }).message === 'string') {
        message = (body.error as { message: string }).message
      } else if (typeof body.message === 'string') message = body.message
    } catch {
      message = text.trim() || undefined
    }
    return message ? redact(message, secret).slice(0, MAX_ERROR_MESSAGE) : undefined
  } catch {
    return undefined
  }
}

/** Maps a non-2xx response to an AppErrorException (`model` set when the request was about one model). */
export async function httpError(
  response: Response,
  options: { model?: string; secret?: string } = {}
): Promise<AppErrorException> {
  const { status } = response
  const message = await readErrorMessage(response, options.secret)
  const withMessage = (params: Record<string, string | number>): Record<string, string | number> =>
    message ? { ...params, message } : params
  if (status === 401 || status === 403) return new AppErrorException('ai.unauthorized')
  if (status === 429) {
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
    return new AppErrorException('ai.rateLimited', retryAfter !== undefined ? { retryAfter } : {})
  }
  if (status === 404 && options.model) {
    return new AppErrorException('ai.modelNotFound', { model: options.model })
  }
  return new AppErrorException('ai.providerError', withMessage({ status }))
}

export interface HttpClientOptions {
  baseUrl: string
  apiKey?: string
  extraHeaders?: Record<string, string>
  fetch: FetchLike
  logger?: ProviderLogger
  sleep?: SleepFn
  /** Retries on 429/5xx (before any data was read). Default 2. */
  maxRetries?: number
  /** First backoff delay; doubles on each retry. Default 1000 ms. */
  retryBaseDelayMs?: number
  /** Upper bound for one backoff delay (also caps Retry-After). Default 30 s. */
  maxRetryDelayMs?: number
}

export interface RequestOptions {
  method: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
  /** Model the request is about: a 404 becomes 'ai.modelNotFound'. */
  model?: string
}

export interface HttpClient {
  readonly baseUrl: URL
  /** Sends a request with retries; resolves the 2xx response (body unread). */
  request(path: string, options: RequestOptions): Promise<Response>
  /** `request` + JSON body ('ai.invalidResponse' when unparsable). */
  json<T>(path: string, options: RequestOptions): Promise<T>
}

/**
 * Small HTTP client shared by the adapters: Bearer auth, same-origin URLs only, no redirects followed
 * (a redirect could carry the key elsewhere), typed errors and exponential backoff on 429/5xx.
 */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const baseUrl = assertSafeBaseUrl(options.baseUrl)
  assertValidExtraHeaders(options.extraHeaders)
  const {
    apiKey,
    fetch,
    logger = console,
    sleep = defaultSleep,
    maxRetries = 2,
    retryBaseDelayMs = 1000,
    maxRetryDelayMs = 30_000
  } = options

  function headers(hasBody: boolean): Record<string, string> {
    const h: Record<string, string> = {
      ...(options.extraHeaders ?? {}),
      Accept: 'application/json'
    }
    if (hasBody) h['Content-Type'] = 'application/json'
    if (apiKey) h['Authorization'] = `Bearer ${apiKey}`
    return h
  }

  async function request(path: string, req: RequestOptions): Promise<Response> {
    const url = joinUrl(baseUrl, path)
    const hasBody = req.body !== undefined
    const init: RequestInit = {
      method: req.method,
      headers: headers(hasBody),
      body: hasBody ? JSON.stringify(req.body) : undefined,
      signal: req.signal,
      redirect: 'manual'
    }
    for (let attempt = 0; ; attempt++) {
      if (req.signal?.aborted) throw abortError(req.signal)
      let response: Response
      try {
        response = await fetch(url, init)
      } catch (err) {
        if (req.signal?.aborted) throw abortError(req.signal)
        logger.warn('[ai] request failed', {
          method: req.method,
          url,
          headers: redactHeaders(init.headers as Record<string, string>),
          error: redact(String((err as Error)?.message ?? err), apiKey)
        })
        throw new AppErrorException('ai.network')
      }
      if (response.ok) return response

      const retryable = response.status === 429 || response.status >= 500
      if (retryable && attempt < maxRetries) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
        const delay = Math.min(
          maxRetryDelayMs,
          retryAfter !== undefined ? retryAfter * 1000 : retryBaseDelayMs * 2 ** attempt
        )
        await response.body?.cancel().catch(() => undefined)
        try {
          await sleep(delay, req.signal)
        } catch {
          if (req.signal?.aborted) throw abortError(req.signal)
          throw new AppErrorException('ai.network')
        }
        continue
      }
      const error = await httpError(response, { model: req.model, secret: apiKey })
      logger.warn('[ai] provider returned an error', {
        method: req.method,
        url,
        status: response.status,
        code: error.code
      })
      throw error
    }
  }

  return {
    baseUrl,
    request,
    async json<T>(path: string, req: RequestOptions): Promise<T> {
      const response = await request(path, req)
      let text: string
      try {
        text = await response.text()
      } catch {
        if (req.signal?.aborted) throw abortError(req.signal)
        throw new AppErrorException('ai.network')
      }
      try {
        return JSON.parse(text) as T
      } catch {
        throw new AppErrorException('ai.invalidResponse')
      }
    }
  }
}

/**
 * Reads an NDJSON body line by line. Always releases the stream (cancel) when the consumer stops early,
 * the signal aborts or a line is invalid. Throws 'ai.invalidResponse' on an unparsable line.
 */
export async function* readNdjson(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal
): AsyncGenerator<Record<string, unknown>> {
  if (!body) throw new AppErrorException('ai.invalidResponse')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false

  const parse = (line: string): Record<string, unknown> => {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new AppErrorException('ai.invalidResponse')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AppErrorException('ai.invalidResponse')
    }
    return value as Record<string, unknown>
  }

  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch {
        if (signal?.aborted) throw abortError(signal)
        throw new AppErrorException('ai.network')
      }
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) yield parse(line)
        if (signal?.aborted) throw abortError(signal)
      }
    }
    buffer += decoder.decode()
    const last = buffer.trim()
    finished = true
    if (last) yield parse(last)
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
