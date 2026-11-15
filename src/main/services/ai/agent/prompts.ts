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
For textures larger than 64 px, call get_pixels with a rect to read exact pixels before drawing details.
When you are done, stop calling tools and reply with one or two short sentences.`

const SCOPE_INSTRUCTIONS: Record<AgentKind, string> = {
  editor: EDITOR_INSTRUCTIONS,
  navigation: '',
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
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const preamble = fill(COMMON_PREAMBLE, {
    uiLanguage: LANGUAGE_NAMES[input.language],
    styleBriefJson: briefForPrompt(input.brief)
  })
  const scope = fill(SCOPE_INSTRUCTIONS[input.agent], {
    width: input.texture?.width ?? '?',
    height: input.texture?.height ?? '?'
  })
  return scope ? `${preamble}\n\n${scope}` : preamble
}
