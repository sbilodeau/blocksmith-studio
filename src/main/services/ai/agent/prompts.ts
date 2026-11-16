import type { AgentKind } from '@shared/ai/types'
import type { StyleBrief } from '@shared/model/brief'
import type { Language } from '@shared/model/settings'

/** System prompts (PLAN 6.4). Kept in English; the model replies in the UI language. */

const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', fr: 'French' }

export const COMMON_PREAMBLE = `You are a Minecraft Java Edition resource pack artist assistant inside Blocksmith Studio.
You NEVER modify files directly. You act only by calling the provided tools; every change is shown to the user
as a plan they approve. Prefer few, precise tool calls.
Coordinates: origin (0,0) is the TOP-LEFT pixel; x grows to the right, y grows downward.
Colors are hex "#RRGGBBAA" (alpha optional, default FF). Transparent = "#00000000".
Rotation: "left"/"à gauche"/"anti-horaire" = counterclockwise; "right"/"à droite"/"horaire" = clockwise.
Flip: "horizontal" mirrors left<->right; "vertical" mirrors top<->bottom.
Respect the pack STYLE BRIEF below unless the user explicitly overrides it. If the user states a lasting
preference, propose update_style_brief.
Reply in {{uiLanguage}}. If the user writes in another language, reply in the user's language.
Keep text replies short; the plan UI already describes each operation.
STYLE BRIEF:
{{styleBriefJson}}`

export const EDITOR_INSTRUCTIONS = `Your scope is the open texture {{width}} x {{height}}. You receive an upscaled image with a coordinate grid and/or a
palette-indexed JSON grid of its pixels (rows[y][x], "." = transparent). Use transforms for geometry, drawing tools
for detail. Stay in the texture's existing palette or the style brief palette. Keep Minecraft's pixel-art style:
no anti-aliasing, limited colors, 1-pixel details, consistent light from the top-left.
Each tool you call runs on a draft and returns the new state, so you can chain steps (for example rotate, then draw on
the rotated result). Coordinates in later calls refer to the state AFTER the previous calls.
When the request includes a 3D MODEL LAYOUT, the texture is wrapped around that 3D model: use its rectangles to know
which pixels are which body part or block face before drawing, and edit every face a change should appear on.
For textures larger than 64 px, call get_pixels with a rect to read exact pixels before drawing details.
When you are done, stop calling tools and reply with one or two short sentences.`

export const NAVIGATION_INSTRUCTIONS = `Your scope is the user's current selection of {{count}} textures. They are listed by number with their path,
size and main colors; vision models also get contact sheets where each tile shows a texture with its number.
Every color and transform tool applies to EVERY selected texture at once, or only to the textures you name in
"textures" (numbers from the list and/or a glob on "folder/name" such as "*_ore" or "block/*_planks").
Prefer global color operations (hue_shift, apply_palette, replace_color, brightness, saturation, outline) over
anything else; there is no per-pixel drawing in this scope. Use rotate, flip or shift only when the user asks for it.
Call get_palette or get_pixels with a texture number only for textures you need to inspect closely.
Each tool runs on a draft and tells you how many textures changed, so you can chain steps; later steps apply on top
of earlier ones. Keep Minecraft's pixel-art look: limited colors, no smoothing, consistent light from the top-left.
When you are done, stop calling tools and reply with one or two short sentences.`

const SCOPE_INSTRUCTIONS: Record<AgentKind, string> = {
  editor: EDITOR_INSTRUCTIONS,
  navigation: NAVIGATION_INSTRUCTIONS,
  creation: ''
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) =>
    values[k] !== undefined ? String(values[k]) : m
  )
}

/** The brief as sent to models: recent decisions and requests only, compact JSON. */
export function briefForPrompt(brief: StyleBrief): string {
  return JSON.stringify({
    theme: brief.theme,
    palette: brief.palette,
    rules: brief.rules,
    decisions: brief.decisions.slice(-20).map((d) => ({ by: d.by, text: d.text })),
    recentRequests: brief.requestLog.slice(-10).map((r) => ({ agent: r.agent, summary: r.summary }))
  })
}

export interface SystemPromptInput {
  agent: AgentKind
  language: Language
  brief: StyleBrief
  texture?: { width: number; height: number }
  /** Navigation agent: number of selected textures. */
  selection?: { count: number }
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const preamble = fill(COMMON_PREAMBLE, {
    uiLanguage: LANGUAGE_NAMES[input.language],
    styleBriefJson: briefForPrompt(input.brief)
  })
  const scope = fill(SCOPE_INSTRUCTIONS[input.agent], {
    width: input.texture?.width ?? '?',
    height: input.texture?.height ?? '?',
    count: input.selection?.count ?? '?'
  })
  return scope ? `${preamble}\n\n${scope}` : preamble
}
