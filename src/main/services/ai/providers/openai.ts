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
import { capabilitiesFromHints } from './capabilities'
import { abortError, createHttpClient, redact, type HttpClient } from './http'
import { priceFromHints } from './pricing'
import { readSse } from './sse'
import type { AdapterDeps, ListModelsOptions, ProviderAdapterImpl } from './types'

/**
 * OpenAI-compatible adapter (OpenAI, OpenRouter, and any server with /v1/chat/completions: vLLM, LM Studio,
 * Groq, DeepSeek, Ollama's /v1...). The base URL includes the version prefix, e.g. https://api.openai.com/v1.
 *   GET  /models                    -> { data: [{ id, ... }] } (OpenRouter adds name, context_length, pricing,
 *                                      architecture.input_modalities, supported_parameters)
 *   POST /chat/completions (stream) -> SSE `data:` chunks { choices: [{ delta: { content, reasoning_content |
 *                                      reasoning, tool_calls: [{ index, id, function: { name, arguments } }] },
 *                                      finish_reason }], usage }, then `data: [DONE]`
 * Differences with Ollama: tool call arguments are JSON strings streamed in fragments, tool results need
 * `tool_call_id`, images are data URLs, usage needs `stream_options.include_usage`.
 */

type Flavor = 'openai' | 'openrouter' | 'generic'

/** Which request extensions the server understands (unknown fields make api.openai.com answer 400). */
export function flavorOf(baseUrl: string): Flavor {
  let host: string
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return 'generic'
  }
  if (host === 'api.openai.com') return 'openai'
  if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) return 'openrouter'
  return 'generic'
}

/** Ids of /models entries that cannot chat (embeddings, speech, images, moderation, legacy completions). */
const NON_CHAT_MODELS =
  /embed|whisper|tts|dall-e|moderation|davinci|babbage|transcribe|realtime|audio|gpt-image|sora|computer-use|search-preview|rerank/i

/** OpenAI reasoning models (accept `reasoning_effort`). */
const OPENAI_REASONING = /^(o\d|gpt-5)/i

interface WireModel {
  id?: unknown
  name?: unknown
  context_length?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
  architecture?: { input_modalities?: unknown }
  supported_parameters?: unknown
}

interface WireToolCallDelta {
  index?: unknown
  id?: unknown
  function?: { name?: unknown; arguments?: unknown }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

/** Tool call arguments as the JSON string OpenAI expects. */
function argsString(args: unknown): string {
  if (typeof args === 'string') return args
  try {
    return JSON.stringify(args ?? {})
  } catch {
    return '{}'
  }
}

/** Normalized messages -> /chat/completions messages. Reasoning text is not sent back (some servers reject it). */
export function toOpenAiMessages(messages: readonly ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.text ?? '' }
    }
    if (m.role === 'assistant') {
      const wire: Record<string, unknown> = { role: 'assistant', content: m.text ?? '' }
      if (m.toolCalls?.length) {
        wire['content'] = m.text || null
        wire['tool_calls'] = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: argsString(c.args) }
        }))
      }
      return wire
    }
    if (m.images?.length && m.role === 'user') {
      return {
        role: 'user',
        content: [
          ...(m.text ? [{ type: 'text', text: m.text }] : []),
          ...m.images.map((img) => ({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${toBase64(img)}` }
          }))
        ]
      }
    }
    return { role: m.role, content: m.text ?? '' }
  })
}

/** Per-token price string ("0.0000025") -> $ per 1M tokens; undefined for missing, negative or invalid values. */
function perMTok(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.round(n * 1_000_000 * 1e6) / 1e6
}

/** One /models entry -> ModelInfo (provider data first, then the hint tables). */
export function toModelInfo(providerId: string, wire: WireModel): ModelInfo | undefined {
  if (typeof wire.id !== 'string' || !wire.id) return undefined
  const id = wire.id
  const modalities = wire.architecture?.input_modalities
  const params = wire.supported_parameters
  const known = Array.isArray(modalities) || Array.isArray(params)
  const hints = capabilitiesFromHints(id)
  const capabilities: ModelCapabilities = known
    ? {
        vision: Array.isArray(modalities) ? modalities.includes('image') : hints.vision,
        tools: Array.isArray(params) ? params.includes('tools') : hints.tools,
        thinking: Array.isArray(params)
          ? params.includes('reasoning') || params.includes('include_reasoning')
          : hints.thinking
      }
    : hints
  const model: ModelInfo = {
    id,
    providerId,
    label: typeof wire.name === 'string' && wire.name ? `${wire.name} (${id})` : id,
    capabilities,
    capabilitySource: known ? 'provider' : 'hint'
  }
  if (typeof wire.context_length === 'number' && wire.context_length > 0) {
    model.contextLength = wire.context_length
  }
  const input = perMTok(wire.pricing?.prompt)
  const output = perMTok(wire.pricing?.completion)
  if (input !== undefined && output !== undefined) {
    model.pricing = { inPerMTok: input, outPerMTok: output, source: 'provider' }
  } else {
    const hint = priceFromHints(id)
    if (hint) model.pricing = { ...hint, source: 'hint' }
  }
  return model
}

/** Reasoning fields of the request for this server flavor and model ('off' sends nothing). */
export function reasoningParams(
  flavor: Flavor,
  model: string,
  think: ChatRequest['think'],
  modelCanThink: boolean
): Record<string, unknown> {
  if (!think) return {}
  const effort = think === true ? 'medium' : think
  if (flavor === 'openrouter') return modelCanThink ? { reasoning: { effort } } : {}
  if (flavor === 'openai') return OPENAI_REASONING.test(model) ? { reasoning_effort: effort } : {}
  return modelCanThink ? { reasoning_effort: effort } : {}
}

/** Tool call fragments of one response, assembled by index. */
class ToolCallAssembler {
  private calls: Array<{ id?: string; name: string; args: string }> = []
  private byKey = new Map<string, number>()

  add(delta: WireToolCallDelta): void {
    const id = typeof delta.id === 'string' && delta.id ? delta.id : undefined
    let slot: number | undefined
    if (typeof delta.index === 'number') slot = this.byKey.get(`i${delta.index}`)
    else if (id) slot = this.byKey.get(`id${id}`)
    else slot = this.calls.length - 1 >= 0 ? this.calls.length - 1 : undefined
    if (slot === undefined) {
      slot = this.calls.push({ name: '', args: '' }) - 1
      if (typeof delta.index === 'number') this.byKey.set(`i${delta.index}`, slot)
    }
    const call = this.calls[slot]!
    if (id) {
      call.id ??= id
      this.byKey.set(`id${id}`, slot)
    }
    const fn = delta.function
    if (typeof fn?.name === 'string') call.name += fn.name
    if (typeof fn?.arguments === 'string') call.args += fn.arguments
    else if (fn?.arguments && typeof fn.arguments === 'object')
      call.args = JSON.stringify(fn.arguments)
  }

  get size(): number {
    return this.calls.length
  }

  /** Completed calls; unparsable arguments stay a string (the tool's validation tells the model). */
  finish(): ToolCall[] {
    return this.calls.map((c) => {
      if (!c.name) throw new AppErrorException('ai.invalidResponse')
      let args: unknown = c.args
      try {
        args = c.args.trim() === '' ? {} : JSON.parse(c.args)
      } catch {
        // Left as the raw string.
      }
      return { id: c.id ?? `call_${randomUUID().replace(/-/g, '')}`, name: c.name, args }
    })
  }
}

/** Reasoning text of a stream delta: `reasoning_content` (DeepSeek, vLLM), `reasoning` or `reasoning_details`. */
function reasoningDelta(delta: Record<string, unknown>): string {
  for (const key of ['reasoning_content', 'reasoning']) {
    const v = delta[key]
    if (typeof v === 'string' && v) return v
  }
  const details = delta['reasoning_details']
  if (!Array.isArray(details)) return ''
  return details
    .map((d: { type?: unknown; text?: unknown; summary?: unknown }) =>
      typeof d?.text === 'string' ? d.text : typeof d?.summary === 'string' ? d.summary : ''
    )
    .join('')
}

export function createOpenAiAdapter(deps: AdapterDeps): ProviderAdapterImpl {
  const { config, logger = console } = deps
  const flavor = flavorOf(config.baseUrl)
  const http: HttpClient = createHttpClient({
    baseUrl: config.baseUrl,
    apiKey: deps.apiKey,
    extraHeaders: config.extraHeaders,
    fetch: deps.fetch,
    logger,
    sleep: deps.sleep,
    retryBaseDelayMs: deps.retryBaseDelayMs
  })

  /** Last model list, used to know whether a model can think (kept for the adapter's lifetime). */
  let known: Map<string, ModelInfo> | null = null

  async function listModels(options: ListModelsOptions = {}): Promise<ModelInfo[]> {
    const body = await http.json<{ data?: unknown }>('/models', {
      method: 'GET',
      signal: options.signal
    })
    if (!body || !Array.isArray(body.data)) throw new AppErrorException('ai.invalidResponse')
    const seen = new Set<string>()
    const list = (body.data as WireModel[])
      .map((w) => toModelInfo(config.id, w ?? {}))
      .filter((m): m is ModelInfo => {
        if (!m || seen.has(m.id) || NON_CHAT_MODELS.test(m.id)) return false
        seen.add(m.id)
        return true
      })
      .sort((a, b) => a.id.localeCompare(b.id))
    known = new Map(list.map((m) => [m.id, m]))
    return list
  }

  async function canThink(model: string, signal: AbortSignal): Promise<boolean> {
    if (!known && flavor === 'openrouter') {
      try {
        await listModels({ signal })
      } catch (err) {
        if (signal.aborted) throw abortError(signal)
        if ((err as AppErrorException).code === 'ai.unauthorized') throw err
      }
    }
    return (known?.get(model)?.capabilities ?? capabilitiesFromHints(model)).thinking === true
  }

  async function* chat(request: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAiMessages(request.messages),
      stream: true,
      stream_options: { include_usage: true }
    }
    if (request.tools?.length) {
      body['tools'] = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }))
    }
    if (request.think) {
      Object.assign(
        body,
        reasoningParams(flavor, request.model, request.think, await canThink(request.model, signal))
      )
    }
    if (request.temperature !== undefined) body['temperature'] = request.temperature

    const response = await http.request('/chat/completions', {
      method: 'POST',
      body,
      signal,
      model: request.model
    })

    const tools = new ToolCallAssembler()
    let finish: string | undefined
    let usage: Extract<ChatEvent, { type: 'usage' }> | undefined
    for await (const payload of readSse(response.body, signal)) {
      let chunk: Record<string, unknown>
      try {
        chunk = JSON.parse(payload) as Record<string, unknown>
      } catch {
        throw new AppErrorException('ai.invalidResponse')
      }
      if (!chunk || typeof chunk !== 'object') throw new AppErrorException('ai.invalidResponse')
      const error = chunk['error']
      if (error) {
        const message =
          typeof error === 'string'
            ? error
            : typeof (error as { message?: unknown }).message === 'string'
              ? (error as { message: string }).message
              : 'error'
        throw new AppErrorException('ai.providerError', {
          status: response.status,
          message: redact(message, deps.apiKey).slice(0, 300)
        })
      }
      const choices = chunk['choices']
      if (Array.isArray(choices) && choices.length > 0) {
        const choice = choices[0] as { delta?: Record<string, unknown>; finish_reason?: unknown }
        const delta = choice.delta
        if (delta && typeof delta === 'object') {
          const thinking = reasoningDelta(delta)
          if (thinking) yield { type: 'thinking', delta: thinking }
          if (typeof delta['content'] === 'string' && delta['content']) {
            yield { type: 'text', delta: delta['content'] }
          }
          if (Array.isArray(delta['tool_calls'])) {
            for (const d of delta['tool_calls']) tools.add((d ?? {}) as WireToolCallDelta)
          }
        }
        if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
          finish = choice.finish_reason
        }
      }
      const u = chunk['usage'] as
        { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown } | null | undefined
      if (u && typeof u === 'object') {
        usage = {
          type: 'usage',
          ...(typeof u.prompt_tokens === 'number' ? { inputTokens: u.prompt_tokens } : {}),
          ...(typeof u.completion_tokens === 'number' ? { outputTokens: u.completion_tokens } : {}),
          // OpenRouter reports the cost in credits (1 credit = 1 USD).
          ...(flavor === 'openrouter' && typeof u.cost === 'number' ? { costUsd: u.cost } : {})
        }
      }
    }
    if (signal.aborted) throw abortError(signal)
    if (finish === undefined && tools.size === 0 && !usage) {
      // The stream ended before any choice finished.
      throw new AppErrorException('ai.invalidResponse')
    }
    for (const call of tools.finish()) yield { type: 'tool_call', call }
    if (usage) yield usage
    yield {
      type: 'done',
      stopReason: tools.size > 0 ? 'tool_calls' : finish === 'length' ? 'length' : 'end'
    }
  }

  return { providerId: config.id, listModels, chat }
}
