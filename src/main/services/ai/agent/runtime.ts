import { z } from 'zod'
import { encodePng, type RgbaImage } from '@shared/image'
import { ToolError, getTool, toolSpecs, type AnyTool } from '@shared/ai/tools'
import type {
  AgentEvent,
  AgentSettings,
  ChatMessage,
  ConversationTurn,
  EditorAgentRequest,
  ProposalStep,
  ToolCall,
  ToolKind
} from '@shared/ai/types'
import type { StyleBrief, StyleBriefPatch } from '@shared/model/brief'
import type { ProviderRegistry } from '../../contracts'
import { applyBriefPatch } from '../../brief'
import { buildSystemPrompt } from './prompts'
import {
  buildUserMessage,
  estimateTokens,
  historyMessages,
  latestImageOnly,
  messageTokens,
  planImages,
  sendsGrid,
  textureState,
  type ImagePlan
} from './context'

/** Default token budget per user request (input + output, all iterations). */
export const DEFAULT_TOKEN_BUDGET = 150_000
/** With vision, a fresh image is attached after this many mutate steps (grid results in between). */
export const IMAGE_EVERY_STEPS = 3

export type RunReason = Extract<AgentEvent, { type: 'done' }>['reason']

export interface RunInput {
  runId: string
  request: EditorAgentRequest
  /** Decoded request.texture.png. */
  base: RgbaImage
  settings: AgentSettings
  brief: StyleBrief
  vanilla: RgbaImage | null
  history: ConversationTurn[]
}

export interface RunDeps {
  providers: ProviderRegistry
  newId: () => string
  now: () => Date
  tokenBudget?: number
}

export interface RunResult {
  reason: RunReason
  error?: { code: string; params?: Record<string, string | number> }
  steps: ProposalStep[]
  /** Assistant and tool turns of this run, in order (the caller persists them). */
  turns: ConversationTurn[]
  iterations: number
}

type Emit = (event: AgentEvent) => void

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

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err instanceof Error && err.name === 'AbortError')
}

function argsOf(call: ToolCall): unknown {
  if (typeof call.args !== 'string') return call.args ?? {}
  try {
    return JSON.parse(call.args)
  } catch {
    return call.args
  }
}

function issues(err: z.ZodError): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ')
}

interface CallOutcome {
  ok: boolean
  kind: ToolKind
  summary: string
  /** JSON text returned to the model. */
  content: string
  mutated?: boolean
}

/**
 * The editor agent loop (PLAN 6.2): streams provider events, validates and executes tool calls against an
 * in-memory draft, records proposal steps, and stops on end of turn, iteration or token budget, or abort.
 * Never writes files; never throws (errors end the run with reason 'error').
 */
export async function runEditorAgent(
  input: RunInput,
  deps: RunDeps,
  emit: Emit,
  signal: AbortSignal
): Promise<RunResult> {
  const { runId, request, settings } = input
  const turns: ConversationTurn[] = []
  const steps: ProposalStep[] = []
  const tokenBudget = deps.tokenBudget ?? DEFAULT_TOKEN_BUDGET
  const at = (): string => deps.now().toISOString()
  let draft = input.base
  let brief = input.brief
  let iterations = 0
  let tokens = 0
  let mutateSinceImage = 0

  const finish = (reason: RunReason, error?: RunResult['error']): RunResult => ({
    reason,
    ...(error ? { error } : {}),
    steps,
    turns,
    iterations
  })

  // Unknown or failing model info -> no vision (grid only).
  const model = await Promise.resolve()
    .then(() => deps.providers.getModel(request.model))
    .catch(() => undefined)
  const plan: ImagePlan = planImages(model, settings.imageMode)

  const tools = toolSpecs('editor')
  const messages: ChatMessage[] = [
    {
      role: 'system',
      text: buildSystemPrompt({
        agent: 'editor',
        language: request.language,
        brief,
        texture: { width: draft.width, height: draft.height }
      })
    },
    ...historyMessages(input.history),
    buildUserMessage(request.message, request.texture.path, draft, plan)
  ]

  function execute(call: ToolCall): CallOutcome {
    const tool: AnyTool | undefined = getTool(call.name)
    if (!tool || !tool.scopes.includes('editor')) {
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
    const parsed = tool.params.safeParse(argsOf(call))
    if (!parsed.success) {
      const detail = issues(parsed.error)
      return {
        ok: false,
        kind: tool.kind,
        summary: `Invalid arguments for ${tool.name}: ${detail}`,
        content: JSON.stringify({ ok: false, error: `Invalid arguments: ${detail}` })
      }
    }
    let out
    try {
      out = tool.execute({ image: draft, vanilla: input.vanilla, brief }, parsed.data)
    } catch (err) {
      const message =
        err instanceof ToolError
          ? err.message
          : `The tool failed: ${err instanceof Error ? err.message : String(err)}`
      return {
        ok: false,
        kind: tool.kind,
        summary: message,
        content: JSON.stringify({ ok: false, error: message })
      }
    }
    if (tool.kind === 'read') {
      return {
        ok: true,
        kind: 'read',
        summary: out.summary,
        content: JSON.stringify({ ok: true, result: out.result })
      }
    }
    if (tool.kind === 'memory') {
      const patch = (parsed.data as { patch: StyleBriefPatch }).patch
      brief = applyBriefPatch(brief, patch, 'editor', at())
      steps.push({
        id: deps.newId(),
        callId: call.id,
        tool: tool.name,
        args: parsed.data,
        kind: 'memory',
        description: tool.describe(parsed.data),
        dependsOn: [],
        briefPatch: patch
      })
      return {
        ok: true,
        kind: 'memory',
        summary: out.summary,
        content: JSON.stringify({ ok: true, result: out.result })
      }
    }
    // Mutate: the draft moves forward. Every mutate step depends on all earlier mutate steps (coordinates and
    // colors of a step refer to the state the earlier steps produced).
    if (out.image) draft = out.image
    const dependsOn = steps.filter((s) => s.kind === 'mutate').map((s) => s.id)
    steps.push({
      id: deps.newId(),
      callId: call.id,
      tool: tool.name,
      args: parsed.data,
      kind: 'mutate',
      description: tool.describe(parsed.data),
      dependsOn,
      previewPng: encodePng(draft)
    })
    const state = textureState(draft, plan, false)
    return {
      ok: true,
      kind: 'mutate',
      summary: out.summary,
      mutated: true,
      content: JSON.stringify({
        ok: true,
        summary: out.summary,
        result: out.result,
        texture: state.grid ?? state.text
      })
    }
  }

  try {
    const adapter = await deps.providers.getAdapter(request.model.providerId)
    while (iterations < settings.maxIterations) {
      if (signal.aborted) return finish('stopped')
      iterations++
      const sent = latestImageOnly(messages)
      let text = ''
      let thinking = ''
      const calls: ToolCall[] = []
      let usage: { inputTokens?: number; outputTokens?: number; costUsd?: number } | undefined
      for await (const ev of adapter.chat(
        {
          model: request.model.modelId,
          messages: sent,
          tools,
          ...(settings.thinking ? { think: true } : {})
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
        model: request.model,
        ...(usage ? { usage } : {})
      })

      if (calls.length === 0) return finish('end')

      let mutated = false
      for (const call of calls) {
        if (signal.aborted) return finish('stopped')
        const tool = getTool(call.name)
        emit({
          runId,
          type: 'tool_call',
          call,
          kind: tool?.kind ?? 'read',
          iteration: iterations
        })
        const outcome = execute(call)
        if (outcome.mutated) {
          mutated = true
          mutateSinceImage++
        }
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

      // Fresh image for vision models: every step in image mode or when the grid is not inline, else every K steps.
      if (
        mutated &&
        plan.image &&
        (!plan.grid || !sendsGrid(draft, plan) || mutateSinceImage >= IMAGE_EVERY_STEPS)
      ) {
        const state = textureState(draft, { ...plan, grid: false }, true)
        messages.push({
          role: 'user',
          text: `[App note] Current texture after your changes (${draft.width} x ${draft.height} px). ${state.text}`,
          images: state.png ? [state.png] : []
        })
        mutateSinceImage = 0
      }

      if (tokens >= tokenBudget) return finish('budget')
    }
    return finish('budget')
  } catch (err) {
    if (isAbort(err, signal)) return finish('stopped')
    return finish('error', errorOf(err))
  }
}
