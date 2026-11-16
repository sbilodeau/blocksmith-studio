import { z } from 'zod'
import { imagesEqual, type RgbaImage } from '@shared/image'
import { applyParsed, isBulkTool } from '@shared/bulk/operations'
import { globToRegExp } from '@shared/categories/glob'
import {
  ToolError,
  getTool,
  paletteSummary,
  toolJsonSchema,
  toolsForScope,
  type AnyTool
} from '@shared/ai/tools'
import type {
  AgentSettings,
  ChatMessage,
  ConversationTurn,
  NavigationAgentRequest,
  ProposalStep,
  ToolCall,
  ToolKind,
  ToolSpec
} from '@shared/ai/types'
import type { StyleBrief, StyleBriefPatch } from '@shared/model/brief'
import { applyBriefPatch } from '../../brief'
import { buildSystemPrompt } from './prompts'
import { historyMessages, planImages, type ImagePlan } from './context'
import { contactSheetPngs, MAX_SHEETS, TILES_PER_SHEET, type SheetTexture } from './contact-sheet'
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
import { shortTexturePath } from './proposals'

/**
 * The navigation agent (PLAN 6.3, M5): works on the grid selection. Every color and transform tool of the registry
 * applies to all selected textures (or a `textures` subset), on in-memory drafts; each call is one proposal step.
 */

/** Texture lines listed in the user message before the rest is summarized by folder. */
export const MAX_LISTED_TEXTURES = 300

export interface NavigationTexture {
  path: string
  image: RgbaImage
  /** Animated strips: operations run per frame, sheets show the first frame. */
  frameHeight?: number
}

export interface NavigationRunInput {
  runId: string
  request: NavigationAgentRequest
  /** Decoded selection, in grid order (index = position + 1). */
  textures: NavigationTexture[]
  settings: AgentSettings
  brief: StyleBrief
  history: ConversationTurn[]
}

export interface NavigationRunResult {
  reason: RunReason
  error?: { code: string; params?: Record<string, string | number> }
  steps: ProposalStep[]
  turns: ConversationTurn[]
  iterations: number
  /** Textures the steps changed, after all steps. */
  changed: Map<string, RgbaImage>
}

const TextureFilterSchema = z
  .object({
    indices: z
      .array(z.number().int().min(1))
      .max(2000)
      .optional()
      .describe('Numbers of textures in the selection list'),
    match: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Glob on "folder/name" (e.g. "block/*_planks") or on the name alone (e.g. "*_ore"); * matches any characters'
      )
  })
  .strict()
  .describe(
    'Optional subset of the selection: textures whose number is in indices OR whose path matches the glob. Default: every selected texture.'
  )

const IndexParam = z.number().int().min(1).describe('Number of the texture in the selection list')

/** Folder/name of a texture path: "block/stone" from "assets/minecraft/textures/block/stone.png". */
function folderName(path: string): string {
  return shortTexturePath(path).replace(/\.png$/, '')
}

interface ScopedTool {
  tool: AnyTool
  /** Schema the model's arguments are validated with (the tool's own, plus `textures` or `index`). */
  schema: z.ZodType
  spec: ToolSpec
  mode: 'bulk' | 'inspect' | 'plain'
}

function extend(tool: AnyTool, shape: z.ZodRawShape): z.ZodType {
  return tool.params instanceof z.ZodObject ? tool.params.extend(shape) : z.object(shape)
}

/** Tools of the navigation scope with their extended schemas and specs. */
export function navigationTools(): ScopedTool[] {
  return toolsForScope('navigation').map((tool): ScopedTool => {
    if (tool.kind === 'mutate' && isBulkTool(tool.name)) {
      const schema = extend(tool, { textures: TextureFilterSchema.optional() })
      return {
        tool,
        schema,
        mode: 'bulk',
        spec: {
          name: tool.name,
          description: `${tool.description}\nIn this scope the operation applies to EVERY selected texture, or only to "textures" when given. Coordinates of "region" are per texture.`,
          parameters: toolJsonSchema({ ...tool, params: schema })
        }
      }
    }
    if (tool.kind === 'read' && (tool.name === 'get_pixels' || tool.name === 'get_palette')) {
      const schema = extend(tool, { index: IndexParam })
      return {
        tool,
        schema,
        mode: 'inspect',
        spec: {
          name: tool.name,
          description: `${tool.description}\nIn this scope, "index" says which selected texture to read.`,
          parameters: toolJsonSchema({ ...tool, params: schema })
        }
      }
    }
    return {
      tool,
      schema: tool.params,
      mode: 'plain',
      spec: { name: tool.name, description: tool.description, parameters: toolJsonSchema(tool) }
    }
  })
}

/** One line per texture: number, folder/name, size, main colors. */
function textureLine(index: number, t: NavigationTexture): string {
  const { colors, transparent } = paletteSummary(t.image)
  const top = colors
    .slice(0, 4)
    .map((c) => c.hex)
    .join(' ')
  const frames = t.frameHeight ? `, ${t.image.height / t.frameHeight} frames` : ''
  const clear = transparent > 0 ? ', has transparency' : ''
  return `#${index} ${folderName(t.path)} ${t.image.width}x${t.image.height}${frames}${clear}: ${top}`
}

/** The user message of a navigation run: the selection list (+ contact sheets for vision), then the request. */
export function buildNavigationMessage(
  message: string,
  textures: readonly NavigationTexture[],
  plan: ImagePlan
): ChatMessage {
  const lines = textures.slice(0, MAX_LISTED_TEXTURES).map((t, i) => textureLine(i + 1, t))
  const rest = textures.slice(MAX_LISTED_TEXTURES)
  if (rest.length > 0) {
    const byFolder = new Map<string, number>()
    for (const t of rest) {
      const folder = folderName(t.path).split('/').slice(0, -1).join('/') || '(root)'
      byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1)
    }
    lines.push(
      `... and ${rest.length} more textures (#${MAX_LISTED_TEXTURES + 1}-#${textures.length}): ${[
        ...byFolder
      ]
        .map(([f, n]) => `${f} (${n})`)
        .join(', ')}. Operations without "textures" apply to them too.`
    )
  }
  const parts = [
    `[Selection: ${textures.length} textures]`,
    'Textures (number, folder/name, size, main colors):',
    ...lines
  ]
  let images: Uint8Array[] | undefined
  if (plan.image) {
    images = contactSheetPngs(textures.map((t, i) => sheetTexture(i + 1, t)))
    const shown = Math.min(textures.length, MAX_SHEETS * TILES_PER_SHEET)
    parts.push(
      `The attached contact sheet${images.length > 1 ? 's show' : ' shows'} textures #1-#${shown}, each tile labeled with its number above it; transparent pixels are drawn on a gray checkerboard.`
    )
  }
  parts.push('', 'User request:', message)
  return { role: 'user', text: parts.join('\n'), ...(images?.length ? { images } : {}) }
}

function sheetTexture(index: number, t: NavigationTexture): SheetTexture {
  return { index, image: t.image, ...(t.frameHeight ? { frameHeight: t.frameHeight } : {}) }
}

/** Selected textures a filter designates (all when no filter), as indexes into `textures`. */
export function resolveTargets(
  textures: readonly NavigationTexture[],
  filter: z.output<typeof TextureFilterSchema> | undefined
): number[] {
  const all = textures.map((_, i) => i)
  if (!filter || (!filter.indices?.length && !filter.match)) return all
  const wanted = new Set((filter.indices ?? []).map((n) => n - 1))
  const glob = filter.match ? globToRegExp(filter.match) : null
  const onName = filter.match ? !filter.match.includes('/') : false
  return all.filter((i) => {
    if (wanted.has(i)) return true
    if (!glob) return false
    const fn = folderName(textures[i]!.path)
    return glob.test(onName ? fn.slice(fn.lastIndexOf('/') + 1) : fn)
  })
}

export async function runNavigationAgent(
  input: NavigationRunInput,
  deps: LoopDeps,
  emit: Emit,
  signal: AbortSignal
): Promise<NavigationRunResult> {
  const { request, settings, textures } = input
  const steps: ProposalStep[] = []
  const at = (): string => deps.now().toISOString()
  const draft = textures.map((t) => t.image)
  const touched = new Set<number>()
  let brief = input.brief

  const model = await Promise.resolve()
    .then(() => deps.providers.getModel(request.model))
    .catch(() => undefined)
  const plan = planImages(model, settings.imageMode)
  const scoped = navigationTools()
  const byName = new Map(scoped.map((s) => [s.tool.name, s]))
  const specs = scoped.map((s) => s.spec)

  const messages: ChatMessage[] = [
    {
      role: 'system',
      text: buildSystemPrompt({
        agent: 'navigation',
        language: request.language,
        brief,
        selection: { count: textures.length }
      })
    },
    ...historyMessages(input.history),
    buildNavigationMessage(request.message, textures, plan)
  ]
  let lastChanged: number[] = []

  function fail(kind: ToolKind, message: string): CallOutcome {
    return {
      ok: false,
      kind,
      summary: message,
      content: JSON.stringify({ ok: false, error: message })
    }
  }

  function execute(call: ToolCall): CallOutcome {
    const s = byName.get(call.name)
    if (!s) return unknownTool(call, specs)
    const parsed = s.schema.safeParse(argsOf(call))
    if (!parsed.success) {
      return fail(s.tool.kind, `Invalid arguments for ${s.tool.name}: ${issues(parsed.error)}`)
    }
    const data = parsed.data as Record<string, unknown>

    if (s.mode === 'inspect') {
      const { index, ...args } = data as { index: number }
      const img = draft[index - 1]
      if (!img)
        return fail('read', `There is no texture #${index} (the selection has ${textures.length}).`)
      try {
        const out = s.tool.execute({ image: img, brief }, s.tool.params.parse(args))
        return {
          ok: true,
          kind: 'read',
          summary: `${out.summary} (#${index})`,
          content: JSON.stringify({ ok: true, texture: index, result: out.result })
        }
      } catch (err) {
        return fail('read', err instanceof ToolError ? err.message : String(err))
      }
    }

    if (s.mode === 'plain') {
      let out
      try {
        out = s.tool.execute({ image: draft[0]!, brief }, data)
      } catch (err) {
        return fail(s.tool.kind, err instanceof ToolError ? err.message : String(err))
      }
      if (s.tool.kind === 'memory') {
        const patch = (data as { patch: StyleBriefPatch }).patch
        brief = applyBriefPatch(brief, patch, 'navigation', at())
        steps.push({
          id: deps.newId(),
          callId: call.id,
          tool: s.tool.name,
          args: data,
          kind: 'memory',
          description: s.tool.describe(data),
          dependsOn: [],
          briefPatch: patch
        })
      }
      return {
        ok: true,
        kind: s.tool.kind,
        summary: out.summary,
        content: JSON.stringify({ ok: true, result: out.result })
      }
    }

    // Bulk: the operation runs on every targeted texture's draft.
    const { textures: filter, ...args } = data as {
      textures?: z.output<typeof TextureFilterSchema>
    }
    const targets = resolveTargets(textures, filter)
    if (targets.length === 0) {
      return fail('mutate', 'No selected texture matches "textures"; nothing was changed.')
    }
    const op = { tool: s.tool, args: s.tool.params.parse(args) }
    const changed: number[] = []
    const failed: string[] = []
    for (const i of targets) {
      try {
        const next = applyParsed(draft[i]!, op, {
          ...(textures[i]!.frameHeight ? { frameHeight: textures[i]!.frameHeight } : {}),
          brief
        })
        if (!imagesEqual(next, draft[i]!)) {
          draft[i] = next
          changed.push(i)
          touched.add(i)
        }
      } catch (err) {
        failed.push(`#${i + 1}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const dependsOn = steps.filter((x) => x.kind === 'mutate').map((x) => x.id)
    steps.push({
      id: deps.newId(),
      callId: call.id,
      tool: s.tool.name,
      args: op.args,
      kind: 'mutate',
      description: s.tool.describe(op.args),
      dependsOn,
      targets: targets.map((i) => textures[i]!.path)
    })
    lastChanged = changed
    const summary = `${s.tool.name} on ${targets.length} texture(s): ${changed.length} changed, ${
      targets.length - changed.length - failed.length
    } unchanged${failed.length ? `, ${failed.length} failed` : ''}`
    return {
      ok: true,
      kind: 'mutate',
      summary,
      mutated: changed.length > 0,
      content: JSON.stringify({
        ok: true,
        summary,
        changed: changed.slice(0, 60).map((i) => i + 1),
        ...(failed.length ? { failed: failed.slice(0, 10) } : {})
      })
    }
  }

  /** Vision models see the textures they just changed (one contact sheet). */
  function afterTools(mutated: boolean): ChatMessage | undefined {
    if (!mutated || !plan.image || lastChanged.length === 0) return undefined
    const shown = lastChanged.slice(0, TILES_PER_SHEET)
    const [sheet] = contactSheetPngs(
      shown.map((i) => sheetTexture(i + 1, { ...textures[i]!, image: draft[i]! }))
    )
    return {
      role: 'user',
      text: `[App note] Textures after your last changes (${shown.map((i) => `#${i + 1}`).join(', ')}${
        lastChanged.length > shown.length ? `, and ${lastChanged.length - shown.length} more` : ''
      }).`,
      images: sheet ? [sheet] : []
    }
  }

  const result = await runAgentLoop(
    {
      agent: 'navigation',
      tools: specs,
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
  const changed = new Map<string, RgbaImage>()
  for (const i of touched) {
    if (!imagesEqual(draft[i]!, textures[i]!.image)) changed.set(textures[i]!.path, draft[i]!)
  }
  return { ...result, steps, changed }
}

/** Steps' operations per texture, for replaying the accepted steps on the accepted textures. */
export function replayTargets(
  steps: readonly ProposalStep[],
  acceptedStepIds: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>
): Array<{ path: string; ops: Array<{ tool: string; args: Record<string, unknown> }> }> {
  const byPath = new Map<string, Array<{ tool: string; args: Record<string, unknown> }>>()
  for (const step of steps) {
    if (step.kind !== 'mutate' || !acceptedStepIds.has(step.id)) continue
    for (const path of step.targets ?? []) {
      if (!acceptedPaths.has(path)) continue
      const list = byPath.get(path) ?? []
      list.push({ tool: step.tool, args: step.args as Record<string, unknown> })
      byPath.set(path, list)
    }
  }
  return [...byPath].map(([path, ops]) => ({ path, ops }))
}
