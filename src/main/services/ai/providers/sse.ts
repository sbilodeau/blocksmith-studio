import { AppErrorException } from '../../../ipc/registry'
import { abortError } from './http'

/**
 * Reads a Server-Sent Events body (OpenAI-compatible streaming) and yields the `data` payload of each event.
 * Comment lines (": OPENROUTER PROCESSING") and other fields are ignored; multi-line data is joined with "\n".
 * Stops after `[DONE]`. Always releases the stream when the consumer stops early or the signal aborts.
 */
export async function* readSse(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal
): AsyncGenerator<string> {
  if (!body) throw new AppErrorException('ai.invalidResponse')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  let finished = false

  /** Handles one line; returns the payload when the line ends an event. */
  const line = (raw: string): string | undefined => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (text === '') {
      if (data.length === 0) return undefined
      const payload = data.join('\n')
      data = []
      return payload
    }
    if (text.startsWith(':')) return undefined
    const colon = text.indexOf(':')
    const field = colon < 0 ? text : text.slice(0, colon)
    if (field !== 'data') return undefined
    let value = colon < 0 ? '' : text.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    data.push(value)
    return undefined
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
        const payload = line(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        if (payload !== undefined) {
          // The finally block releases the connection if the server keeps it open.
          if (payload.trim() === '[DONE]') return
          yield payload
        }
        if (signal?.aborted) throw abortError(signal)
      }
    }
    buffer += decoder.decode()
    if (buffer) line(buffer)
    finished = true
    // A last event without its blank line.
    const payload = line('')
    if (payload !== undefined && payload.trim() !== '[DONE]') yield payload
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
