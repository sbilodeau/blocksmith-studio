import { randomUUID } from 'crypto'
import type {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ModelCapabilities,
  ModelInfo,
  ToolCall
} from '@shared/ai/types'
import { AppErrorException } from '../../../ipc/registry'
import { capabilitiesFromHints, capabilitiesFromOllama } from './capabilities'
import { abortError, createHttpClient, readNdjson, redact, type HttpClient } from './http'
import type { AdapterDeps, ListModelsOptions, ProviderAdapterImpl } from './types'

/**
 * Ollama native API adapter (Ollama Cloud at https://ollama.com, or a self-hosted server).
 * Reference: https://docs.ollama.com/api (chat, tags) and github.com/ollama/ollama api/types.go (show, tool calls).
 *   GET  /api/tags              -> { models: [{ name, model, details, ... }] }
 *   POST /api/show { model }    -> { capabilities: ["completion","tools","vision","thinking"], model_info: { "<arch>.context_length": n } }
 *   POST /api/chat (stream)     -> NDJSON chunks { message: { content, thinking, tool_calls }, done, done_reason, prompt_eval_count, eval_count }
 */

/** Concurrent /api/show requests while listing models. */
export const SHOW_CONCURRENCY = 4

interface OllamaShowInfo {
  capabilities?: ModelCapabilities
  contextLength?: number
}

interface OllamaTagsResponse {
  models?: Array<{ name?: unknown; model?: unknown }>
}

interface OllamaShowResponse {
  capabilities?: unknown
  model_info?: Record<string, unknown> | null
}

interface OllamaWireToolCall {
  id?: unknown
  function?: { index?: unknown; name?: unknown; arguments?: unknown }
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

/** Ollama wants tool call arguments as a JSON object. */
function argsObject(args: unknown): Record<string, unknown> {
  if (typeof args === 'string') {
    try {
      const parsed: unknown = JSON.parse(args)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {}
}

/** Normalized messages -> Ollama /api/chat messages. */
export function toOllamaMessages(messages: readonly ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    const wire: Record<string, unknown> = { role: m.role, content: m.text ?? '' }
    if (m.images?.length) wire['images'] = m.images.map(toBase64)
    if (m.role === 'assistant') {
      if (m.thinking) wire['thinking'] = m.thinking
      if (m.toolCalls?.length) {
        wire['tool_calls'] = m.toolCalls.map((call) => ({
          id: call.id,
          function: { name: call.name, arguments: argsObject(call.args) }
        }))
      }
    }
    if (m.role === 'tool') {
      if (m.toolName) wire['tool_name'] = m.toolName
      if (m.toolCallId) wire['tool_call_id'] = m.toolCallId
    }
    return wire
  })
}

/** Ollama tool call -> normalized call. Arguments may be an object or a JSON string; ids are synthesized when absent. */
export function fromOllamaToolCall(raw: OllamaWireToolCall): ToolCall {
  const fn = raw.function
  if (!fn || typeof fn.name !== 'string' || !fn.name) {
    throw new AppErrorException('ai.invalidResponse')
  }
  let args: unknown = fn.arguments ?? {}
  if (typeof args === 'string') {
    try {
      args = args.trim() === '' ? {} : JSON.parse(args)
    } catch {
      // Left as the raw string: the tool's schema validation reports it to the model, which can retry.
    }
  }
  const id =
    typeof raw.id === 'string' && raw.id ? raw.id : `call_${randomUUID().replace(/-/g, '')}`
  return { id, name: fn.name, args }
}

function contextLengthOf(
  modelInfo: Record<string, unknown> | null | undefined
): number | undefined {
  if (!modelInfo) return undefined
  for (const [key, value] of Object.entries(modelInfo)) {
    if (
      (key === 'context_length' || key.endsWith('.context_length')) &&
      typeof value === 'number'
    ) {
      return value > 0 ? value : undefined
    }
  }
  return undefined
}

export function createOllamaAdapter(deps: AdapterDeps): ProviderAdapterImpl {
  const { config, logger = console } = deps
  const http: HttpClient = createHttpClient({
    baseUrl: config.baseUrl,
    apiKey: deps.apiKey,
    extraHeaders: config.extraHeaders,
    fetch: deps.fetch,
    logger,
    sleep: deps.sleep,
    retryBaseDelayMs: deps.retryBaseDelayMs
  })

  /** /api/show results per model, kept for the adapter's lifetime (failures are not cached). */
  const showCache = new Map<string, Promise<OllamaShowInfo>>()

  function show(model: string, signal?: AbortSignal): Promise<OllamaShowInfo> {
    let pending = showCache.get(model)
    if (!pending) {
      pending = http
        .json<OllamaShowResponse>('/api/show', { method: 'POST', body: { model }, signal, model })
        .then((body) => ({
          capabilities: Array.isArray(body?.capabilities)
            ? capabilitiesFromOllama(body.capabilities.filter((c) => typeof c === 'string'))
            : undefined,
          contextLength: contextLengthOf(body?.model_info)
        }))
      pending.catch(() => showCache.delete(model))
      showCache.set(model, pending)
    }
    return pending
  }

  function toModelInfo(id: string, info: OllamaShowInfo | undefined): ModelInfo {
    const model: ModelInfo = {
      id,
      providerId: config.id,
      label: id,
      capabilities: info?.capabilities ?? capabilitiesFromHints(id),
      capabilitySource: info?.capabilities ? 'provider' : 'hint'
    }
    if (info?.contextLength) model.contextLength = info.contextLength
    // Ollama returns no prices: pricing and costTier stay undefined (PLAN 7.4).
    return model
  }

  async function listModels(options: ListModelsOptions = {}): Promise<ModelInfo[]> {
    const { signal, details = true } = options
    const body = await http.json<OllamaTagsResponse>('/api/tags', { method: 'GET', signal })
    if (!body || !Array.isArray(body.models)) throw new AppErrorException('ai.invalidResponse')
    const ids = [
      ...new Set(
        body.models
          .map((m) => (typeof m?.model === 'string' && m.model ? m.model : m?.name))
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    ].sort((a, b) => a.localeCompare(b))
    if (!details) return ids.map((id) => toModelInfo(id, undefined))
    const infos = await mapLimit(ids, SHOW_CONCURRENCY, async (id) => {
      try {
        return await show(id, signal)
      } catch (err) {
        if (signal?.aborted) throw abortError(signal)
        logger.warn(`[ai] /api/show failed for ${id}, using capability hints`, {
          code: (err as AppErrorException).code
        })
        return undefined
      }
    })
    return ids.map((id, i) => toModelInfo(id, infos[i]))
  }

  /** Whether `think` may be sent: only when /api/show says the model supports it (else Ollama answers 400). */
  async function supportsThinking(model: string, signal: AbortSignal): Promise<boolean> {
    try {
      return (await show(model, signal)).capabilities?.thinking === true
    } catch (err) {
      if (signal.aborted) throw abortError(signal)
      if ((err as AppErrorException).code === 'ai.unauthorized') throw err
      return false
    }
  }

  async function* chat(request: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOllamaMessages(request.messages),
      stream: true
    }
    if (request.tools?.length) {
      body['tools'] = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }))
    }
    // Thinking models think by default: send an explicit true/false only when the model supports it.
    if (await supportsThinking(request.model, signal)) body['think'] = request.think === true
    if (request.temperature !== undefined) body['options'] = { temperature: request.temperature }

    const response = await http.request('/api/chat', {
      method: 'POST',
      body,
      signal,
      model: request.model
    })

    let emittedToolCalls = false
    for await (const chunk of readNdjson(response.body, signal)) {
      if (typeof chunk['error'] === 'string') {
        // Error after the stream started: the HTTP status cannot change (https://docs.ollama.com/api/errors).
        throw new AppErrorException('ai.providerError', {
          status: response.status,
          message: redact(chunk['error'], deps.apiKey).slice(0, 300)
        })
      }
      const message = chunk['message'] as
        { content?: unknown; thinking?: unknown; tool_calls?: unknown } | undefined
      if (message && typeof message === 'object') {
        if (typeof message.thinking === 'string' && message.thinking) {
          yield { type: 'thinking', delta: message.thinking }
        }
        if (typeof message.content === 'string' && message.content) {
          yield { type: 'text', delta: message.content }
        }
        if (Array.isArray(message.tool_calls)) {
          for (const raw of message.tool_calls) {
            emittedToolCalls = true
            yield { type: 'tool_call', call: fromOllamaToolCall(raw as OllamaWireToolCall) }
          }
        }
      }
      if (chunk['done'] === true) {
        const input = chunk['prompt_eval_count']
        const output = chunk['eval_count']
        if (typeof input === 'number' || typeof output === 'number') {
          yield {
            type: 'usage',
            ...(typeof input === 'number' ? { inputTokens: input } : {}),
            ...(typeof output === 'number' ? { outputTokens: output } : {})
          }
        }
        const reason = chunk['done_reason']
        yield {
          type: 'done',
          stopReason: emittedToolCalls ? 'tool_calls' : reason === 'length' ? 'length' : 'end'
        }
        return
      }
    }
    if (signal.aborted) throw abortError(signal)
    // The stream ended without a final `done` chunk.
    throw new AppErrorException('ai.invalidResponse')
  }

  return { providerId: config.id, listModels, chat }
}
