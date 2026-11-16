import { cropImage, encodePng, type RgbaImage } from '@shared/image'
import {
  ToolError,
  executeOnFrames,
  frameCount,
  getTool,
  isFrameTool,
  parseFrame,
  takeFrame,
  toolSpecs,
  type AnyTool,
  type FrameLayout,
  type ToolOutput
} from '@shared/ai/tools'
import type {
  AgentSettings,
  ChatMessage,
  ConversationTurn,
  EditorAgentRequest,
  ProposalStep,
  ToolCall
} from '@shared/ai/types'
import type { StyleBrief, StyleBriefPatch } from '@shared/model/brief'
import { applyBriefPatch } from '../../brief'
import { buildSystemPrompt } from './prompts'
import {
  buildUserMessage,
  historyMessages,
  planImages,
  sendsGrid,
  textureState,
  type ImagePlan
} from './context'
import {
  argsOf,
  issues,
  runAgentLoop,
  unknownTool,
  type CallOutcome,
  type Emit,
  type LoopDeps,
  type RunReason
} from './loop'

export { DEFAULT_TOKEN_BUDGET, thinkValue, errorOf, type RunReason } from './loop'

/** With vision, a fresh image is attached after this many mutate steps (grid results in between). */
export const IMAGE_EVERY_STEPS = 3

export interface RunInput {
  runId: string
  request: EditorAgentRequest
  /** Decoded request.texture.png. */
  base: RgbaImage
  settings: AgentSettings
  brief: StyleBrief
  vanilla: RgbaImage | null
  history: ConversationTurn[]
  /** How the texture wraps its 3D model (body part / block face rectangles), when known. */
  modelLayout?: string
}

/** Frame layout of an animated request, or undefined when the strip does not match it. */
export function frameLayoutOf(
  request: EditorAgentRequest,
  base: RgbaImage
): FrameLayout | undefined {
  const a = request.texture.animation
  if (!a || a.frameHeight > base.height || base.height % a.frameHeight !== 0) return undefined
  const count = base.height / a.frameHeight
  return { frameHeight: a.frameHeight, current: Math.min(a.frame, count - 1) }
}

/** One frame of an animated strip (the whole image otherwise). */
function frameView(img: RgbaImage, layout: FrameLayout | undefined, index: number): RgbaImage {
  if (!layout) return img
  return cropImage(img, {
    x: 0,
    y: index * layout.frameHeight,
    width: img.width,
    height: layout.frameHeight
  })
}

export type RunDeps = LoopDeps

export interface RunResult {
  reason: RunReason
  error?: { code: string; params?: Record<string, string | number> }
  steps: ProposalStep[]
  /** Assistant and tool turns of this run, in order (the caller persists them). */
  turns: ConversationTurn[]
  iterations: number
}

/**
 * The editor agent (PLAN 6.2): tools run against an in-memory draft of the open texture and each mutate call
 * becomes a proposal step. Never writes files; never throws (errors end the run with reason 'error').
 */
export async function runEditorAgent(
  input: RunInput,
  deps: RunDeps,
  emit: Emit,
  signal: AbortSignal
): Promise<RunResult> {
  const { request, settings } = input
  const steps: ProposalStep[] = []
  const at = (): string => deps.now().toISOString()
  let draft = input.base
  let brief = input.brief
  let mutateSinceImage = 0
  const layout = frameLayoutOf(request, input.base)
  const frames = layout ? frameCount(input.base, layout) : 0
  /** Frame shown to the model after a change: the frame last changed (the user's frame at first). */
  let shownFrame = layout?.current ?? 0
  const view = (): RgbaImage => frameView(draft, layout, shownFrame)

  // Unknown or failing model info -> no vision (grid only).
  const model = await Promise.resolve()
    .then(() => deps.providers.getModel(request.model))
    .catch(() => undefined)
  const plan: ImagePlan = planImages(model, settings.imageMode)

  const tools = toolSpecs('editor', layout ? { frames } : {})
  const first = view()
  const messages: ChatMessage[] = [
    {
      role: 'system',
      text: buildSystemPrompt({
        agent: 'editor',
        language: request.language,
        brief,
        texture: { width: first.width, height: first.height },
        ...(layout ? { animation: { frames } } : {})
      })
    },
    ...historyMessages(input.history),
    buildUserMessage(
      layout
        ? `[Animation: ${frames} frames; the user is editing frame ${layout.current}.]\n${request.message}`
        : request.message,
      request.texture.path,
      first,
      plan,
      input.modelLayout
    )
  ]

  function execute(call: ToolCall): CallOutcome {
    const tool: AnyTool | undefined = getTool(call.name)
    if (!tool || !tool.scopes.includes('editor')) return unknownTool(call, tools)
    const framed = !!layout && isFrameTool(tool)
    const split = framed ? takeFrame(argsOf(call)) : { rest: argsOf(call) }
    const parsed = tool.params.safeParse(split.rest)
    if (!parsed.success) {
      const detail = issues(parsed.error)
      return {
        ok: false,
        kind: tool.kind,
        summary: `Invalid arguments for ${tool.name}: ${detail}`,
        content: JSON.stringify({ ok: false, error: `Invalid arguments: ${detail}` })
      }
    }
    let out: ToolOutput
    let frame: number | undefined
    try {
      const ctx = { image: draft, vanilla: input.vanilla, brief }
      if (framed) {
        frame = parseFrame(split.frame, frames)
        out = executeOnFrames(tool, ctx, parsed.data, layout, frame)
      } else {
        out = tool.execute(ctx, parsed.data)
      }
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
    if (frame !== undefined) shownFrame = frame
    const dependsOn = steps.filter((s) => s.kind === 'mutate').map((s) => s.id)
    steps.push({
      id: deps.newId(),
      callId: call.id,
      tool: tool.name,
      // The frame is kept with the arguments so the apply replays the step on the same frame.
      args: frame !== undefined ? { ...(parsed.data as object), frame } : parsed.data,
      kind: 'mutate',
      description: tool.describe(parsed.data),
      dependsOn,
      previewPng: encodePng(draft),
      ...(framed ? { frame: frame ?? ('all' as const) } : {})
    })
    mutateSinceImage++
    const state = textureState(view(), plan, false)
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

  /** Fresh image for vision models: every step in image mode or when the grid is not inline, else every K steps. */
  function afterTools(mutated: boolean): ChatMessage | undefined {
    const shown = view()
    if (
      !mutated ||
      !plan.image ||
      (plan.grid && sendsGrid(shown, plan) && mutateSinceImage < IMAGE_EVERY_STEPS)
    ) {
      return undefined
    }
    mutateSinceImage = 0
    const state = textureState(shown, { ...plan, grid: false }, true)
    const what = layout ? `frame ${shownFrame}` : 'texture'
    return {
      role: 'user',
      text: `[App note] Current ${what} after your changes (${shown.width} x ${shown.height} px). ${state.text}`,
      images: state.png ? [state.png] : []
    }
  }

  const result = await runAgentLoop(
    {
      agent: 'editor',
      tools,
      messages,
      execute,
      kindOf: (name) => getTool(name)?.kind ?? 'read',
      afterTools
    },
    {
      runId: input.runId,
      model: request.model,
      ...(model ? { modelInfo: model } : {}),
      thinking: request.thinking ?? settings.thinking,
      maxIterations: settings.maxIterations
    },
    deps,
    emit,
    signal
  )
  return { ...result, steps }
}
