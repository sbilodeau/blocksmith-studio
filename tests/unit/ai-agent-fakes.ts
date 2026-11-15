import type {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ModelInfo,
  ProviderAdapter
} from '@shared/ai/types'
import type { ProviderRegistry } from '../../src/main/services/contracts'

/** One scripted model response: events, a function of the request, or an error to throw. */
export type Script = ChatEvent[] | ((req: ChatRequest, signal: AbortSignal) => ChatEvent[]) | Error

export interface FakeProvider {
  providers: ProviderRegistry
  /** Requests received, with a snapshot of the messages at call time. */
  requests: ChatRequest[]
}

export function abortError(): Error {
  const err = new Error('aborted')
  err.name = 'AbortError'
  return err
}

/** Scripted ProviderAdapter: each chat() call consumes the next script (then answers with plain text). */
export function fakeProvider(
  scripts: Script[],
  opts: { vision?: boolean; model?: ModelInfo | null } = {}
): FakeProvider {
  const requests: ChatRequest[] = []
  const queue = [...scripts]
  const adapter: ProviderAdapter = {
    providerId: 'fake',
    listModels: async () => [],
    async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
      requests.push({ ...req, messages: req.messages.map((m: ChatMessage) => ({ ...m })) })
      const script = queue.shift() ?? [{ type: 'text', delta: '(no script)' }]
      if (script instanceof Error) throw script
      const events = typeof script === 'function' ? script(req, signal) : script
      for (const ev of events) {
        if (signal.aborted) throw abortError()
        await Promise.resolve()
        yield ev
      }
    }
  }
  const model: ModelInfo | undefined =
    opts.model === null
      ? undefined
      : (opts.model ?? {
          id: 'm1',
          providerId: 'fake',
          label: 'M1',
          capabilities: { vision: opts.vision ?? false, tools: true }
        })
  return {
    requests,
    providers: {
      getAdapter: async () => adapter,
      getModel: async () => model
    }
  }
}

let callSeq = 0

export function toolCall(name: string, args: unknown): ChatEvent {
  callSeq++
  return { type: 'tool_call', call: { id: `call${callSeq}`, name, args } }
}

export function text(delta: string): ChatEvent {
  return { type: 'text', delta }
}

export const DONE_TOOLS: ChatEvent = { type: 'done', stopReason: 'tool_calls' }
export const DONE_END: ChatEvent = { type: 'done', stopReason: 'end' }

/** Deterministic ids: id1, id2, ... */
export function seqIds(prefix = 'id'): () => string {
  let n = 0
  return () => `${prefix}${++n}`
}
