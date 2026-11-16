import type { z } from 'zod'
import type {
  AgentEvent,
  AgentKind,
  ChatMessage,
  ChatRequest,
  ConversationTurn,
  ModelInfo,
  ModelRef,
  ReasoningLevel,
  ToolCall,
  ToolKind,
  ToolSpec
} from '@shared/ai/types'
import type { ProviderRegistry } from '../../contracts'
import { costFromUsage } from '../providers/pricing'
import { estimateTokens, latestImageOnly, messageTokens } from './context'

/**
 * The agent loop shared by every agent (PLAN 6.2): streams the provider, executes the tool calls through the
 * agent's scope, records conversation turns, and stops on end of turn, iteration or token budget, or abort.
 * What a tool does (draft texture, selection of textures...) belongs to the scope.
 */

/** Default token budget per user request (input + output, all iterations). */
export const DEFAULT_TOKEN_BUDGET = 150_000

export type RunReason = Extract<AgentEvent, { type: 'done' }>['reason']

export type Emit = (event: AgentEvent) => void

/** The outcome of one tool call, as the scope reports it. */
export interface CallOutcome {
  ok: boolean
  kind: ToolKind
  summary: string
  /** JSON text returned to the model. */
  content: string
  mutated?: boolean
}

export interface AgentScope {
  agent: AgentKind
  tools: ToolSpec[]
  /** System prompt, history and the user message. */
  messages: ChatMessage[]
  execute(call: ToolCall): CallOutcome | Promise<CallOutcome>
  /** Kind of a tool by name (for tool_call events). */
  kindOf(name: string): ToolKind
  /** After the tool calls of an iteration: an extra message (a fresh image, for example). */
  afterTools?(mutated: boolean): ChatMessage | undefined
}

export interface LoopInput {
  runId: string
  model: ModelRef
  /** Model info when known (used for the request cost). */
  modelInfo?: ModelInfo
  thinking: ReasoningLevel
  maxIterations: number
}

export interface LoopDeps {
  providers: ProviderRegistry
  newId: () => string
  now: () => Date
  tokenBudget?: number
}

export interface LoopResult {
  reason: RunReason
  error?: { code: string; params?: Record<string, string | number> }
  /** Assistant and tool turns of this run, in order (the caller persists them). */
  turns: ConversationTurn[]
  iterations: number
}

/** Reasoning level -> ChatRequest.think ('off' is sent explicitly: thinking models think by default). */
export function thinkValue(level: ReasoningLevel): NonNullable<ChatRequest['think']> {
  return level === 'off' ? false : level
}

/** AppError-like value of any thrown error ('ai.agentFailed' when it carries no code). */
export function errorOf(err: unknown): { code: string; params?: Record<string, string | number> } {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
    const params = (err as { params?: unknown }).params
    return params && typeof params === 'object'
      ? { code: err.code, params: params as Record<string, string | number> }
      : { code: err.code }
  }
  return { code: 'ai.agentFailed' }
}

export function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err instanceof Error && err.name === 'AbortError')
}

/** Tool call arguments as a value (JSON strings parsed; unparsable strings kept for the schema to report). */
export function argsOf(call: ToolCall): unknown {
  if (typeof call.args !== 'string') return call.args ?? {}
  try {
    return JSON.parse(call.args)
  } catch {
    return call.args
  }
}

/** Short English list of zod issues for the model. */
export function issues(err: z.ZodError): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ')
}

/** Tool result for a tool the scope does not offer. */
export function unknownTool(call: ToolCall, tools: readonly ToolSpec[]): CallOutcome {
  return {
    ok: false,
    kind: 'read',
    summary: `Unknown tool ${call.name}`,
    content: JSON.stringify({
      ok: false,
      error: `Unknown tool "${call.name}". Available tools: ${tools.map((t) => t.name).join(', ')}.`
    })
  }
}

export async function runAgentLoop(
  scope: AgentScope,
  input: LoopInput,
  deps: LoopDeps,
  emit: Emit,
  signal: AbortSignal
): Promise<LoopResult> {
  const { runId } = input
  const turns: ConversationTurn[] = []
  const tokenBudget = deps.tokenBudget ?? DEFAULT_TOKEN_BUDGET
  const at = (): string => deps.now().toISOString()
  const messages = scope.messages
  let iterations = 0
  let tokens = 0

  const finish = (reason: RunReason, error?: LoopResult['error']): LoopResult => ({
    reason,
    ...(error ? { error } : {}),
    turns,
    iterations
  })

  try {
    const adapter = await deps.providers.getAdapter(input.model.providerId)
    while (iterations < input.maxIterations) {
      if (signal.aborted) return finish('stopped')
      iterations++
      const sent = latestImageOnly(messages)
      let text = ''
      let thinking = ''
      const calls: ToolCall[] = []
      let usage: { inputTokens?: number; outputTokens?: number; costUsd?: number } | undefined
      for await (let ev of adapter.chat(
        {
          model: input.model.modelId,
          messages: sent,
          tools: scope.tools,
          think: thinkValue(input.thinking)
        },
        signal
      )) {
        if (signal.aborted) break
        if (ev.type === 'text') {
          text += ev.delta
          emit({ runId, type: 'text', delta: ev.delta })
        } else if (ev.type === 'thinking') {
          thinking += ev.delta
          emit({ runId, type: 'thinking', delta: ev.delta })
        } else if (ev.type === 'tool_call') {
          calls.push(ev.call)
        } else if (ev.type === 'usage') {
          // Providers that return no cost (Ollama, OpenAI): computed from the model's known price.
          const costUsd = ev.costUsd ?? costFromUsage(ev, input.modelInfo?.pricing)
          if (costUsd !== undefined) ev = { ...ev, costUsd }
          usage = {
            inputTokens: (usage?.inputTokens ?? 0) + (ev.inputTokens ?? 0),
            outputTokens: (usage?.outputTokens ?? 0) + (ev.outputTokens ?? 0),
            ...(ev.costUsd !== undefined
              ? { costUsd: (usage?.costUsd ?? 0) + ev.costUsd }
              : usage?.costUsd !== undefined
                ? { costUsd: usage.costUsd }
                : {})
          }
          emit({
            runId,
            type: 'usage',
            ...(ev.inputTokens !== undefined ? { inputTokens: ev.inputTokens } : {}),
            ...(ev.outputTokens !== undefined ? { outputTokens: ev.outputTokens } : {}),
            ...(ev.costUsd !== undefined ? { costUsd: ev.costUsd } : {})
          })
        }
      }
      if (signal.aborted) return finish('stopped')

      tokens +=
        usage && (usage.inputTokens || usage.outputTokens)
          ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
          : sent.reduce((n, m) => n + messageTokens(m), 0) +
            estimateTokens(text + thinking + JSON.stringify(calls))

      messages.push({
        role: 'assistant',
        ...(text ? { text } : {}),
        ...(calls.length ? { toolCalls: calls } : {})
      })
      turns.push({
        id: deps.newId(),
        at: at(),
        role: 'assistant',
        ...(text ? { text } : {}),
        ...(thinking ? { thinking } : {}),
        ...(calls.length ? { toolCalls: calls } : {}),
        model: input.model,
        ...(usage ? { usage } : {})
      })

      if (calls.length === 0) return finish('end')

      let mutated = false
      for (const call of calls) {
        if (signal.aborted) return finish('stopped')
        emit({
          runId,
          type: 'tool_call',
          call,
          kind: scope.kindOf(call.name),
          iteration: iterations
        })
        const outcome = await scope.execute(call)
        if (outcome.mutated) mutated = true
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          text: outcome.content
        })
        emit({
          runId,
          type: 'tool_result',
          callId: call.id,
          ok: outcome.ok,
          summary: outcome.summary
        })
        turns.push({
          id: deps.newId(),
          at: at(),
          role: 'tool',
          toolResult: { callId: call.id, ok: outcome.ok, summary: outcome.summary }
        })
      }

      const extra = scope.afterTools?.(mutated)
      if (extra) messages.push(extra)

      if (tokens >= tokenBudget) return finish('budget')
    }
    return finish('budget')
  } catch (err) {
    if (isAbort(err, signal)) return finish('stopped')
    return finish('error', errorOf(err))
  }
}
