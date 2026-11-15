import { encodePng, type RgbaImage } from '@shared/image'
import { MAX_GRID_PIXELS, encodeGrid, paletteSummary } from '@shared/ai/tools'
import type { ChatMessage, ConversationTurn, ImageMode, ModelInfo } from '@shared/ai/types'
import { renderUpscaled } from './render'

/** Textures with a side above this get the image plus "use get_pixels(rect)" instead of the full grid. */
export const LARGE_TEXTURE_SIDE = 64

/** What to send about the texture for a model + image mode (PLAN 6.6). */
export interface ImagePlan {
  vision: boolean
  /** Attach the upscaled PNG. */
  image: boolean
  /** Prefer the inline grid (still subject to size limits, see textureState). */
  grid: boolean
}

export function planImages(model: ModelInfo | undefined, mode: ImageMode): ImagePlan {
  const vision = model?.capabilities.vision === true
  if (!vision || mode === 'grid') return { vision, image: false, grid: true }
  if (mode === 'image') return { vision, image: true, grid: false }
  return { vision, image: true, grid: true }
}

/** Whether the grid of `img` is sent inline for this plan. */
export function sendsGrid(img: RgbaImage, plan: ImagePlan): boolean {
  if (!plan.grid || img.width * img.height > MAX_GRID_PIXELS) return false
  // Large textures with an image: the image carries the overview, get_pixels gives details.
  return !(plan.image && Math.max(img.width, img.height) > LARGE_TEXTURE_SIDE)
}

export interface TextureState {
  text: string
  /** Inline grid object (also used in tool results). */
  grid?: ReturnType<typeof encodeGrid>
  png?: Uint8Array
}

export const IMAGE_NOTE =
  'The attached image shows the texture upscaled with nearest-neighbor, a 1-pixel grid between texture pixels and coordinate labels (column x on top, row y on the left, starting at 0); transparent pixels are drawn on a gray checkerboard.'

/** Upscaled PNG for vision models. */
export function upscaledPng(img: RgbaImage): Uint8Array {
  return encodePng(renderUpscaled(img).image)
}

/** Text (+ image) describing the current texture pixels for the model. */
export function textureState(
  img: RgbaImage,
  plan: ImagePlan,
  withImage = plan.image
): TextureState {
  const parts = [`Texture size: ${img.width} x ${img.height} px.`]
  const state: TextureState = { text: '' }
  if (sendsGrid(img, plan)) {
    state.grid = encodeGrid(img)
    parts.push(
      'Pixels (palette-indexed grid, origin top-left, rows[y][x], "." = transparent):',
      JSON.stringify(state.grid)
    )
  } else {
    const { colors, transparent } = paletteSummary(img)
    parts.push(
      `The full pixel grid is not included; call get_pixels with a rect (at most ${MAX_GRID_PIXELS} pixels) to read exact pixels.`,
      `Palette summary: ${colors.length} colors, ${transparent} transparent pixels. Most used: ${colors
        .slice(0, 16)
        .map((c) => `${c.hex} x${c.count}`)
        .join(', ')}`
    )
  }
  if (withImage) {
    state.png = upscaledPng(img)
    parts.push(IMAGE_NOTE)
  }
  state.text = parts.join('\n')
  return state
}

/** The user message of a run: tagged with the open texture, current state, then the request. */
export function buildUserMessage(
  message: string,
  texturePath: string,
  img: RgbaImage,
  plan: ImagePlan,
  /** How the texture wraps its 3D model (src/shared/preview/layout.ts), when known. */
  layout?: string
): ChatMessage {
  const state = textureState(img, plan)
  const model = layout ? `\n\n${layout}` : ''
  return {
    role: 'user',
    text: `[Open texture: ${texturePath} (${img.width} x ${img.height} px)]\n${state.text}${model}\n\nUser request:\n${message}`,
    ...(state.png ? { images: [state.png] } : {})
  }
}

/** Rough token estimate (4 characters per token). */
export function estimateTokens(text: string | undefined): number {
  return Math.ceil((text?.length ?? 0) / 4)
}

export function messageTokens(m: ChatMessage): number {
  return (
    estimateTokens(m.text) +
    estimateTokens(m.thinking) +
    estimateTokens(m.toolCalls ? JSON.stringify(m.toolCalls) : undefined) +
    // Images: a flat guess (providers bill a 512 px image around 300-800 tokens).
    (m.images?.length ?? 0) * 600
  )
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`
}

/** One persisted turn as a history message (null when it carries nothing useful for the model). */
function turnMessage(turn: ConversationTurn): ChatMessage | null {
  if (turn.role === 'user') {
    const tag = turn.texturePath ? `[Texture: ${turn.texturePath}] ` : ''
    return { role: 'user', text: `${tag}${turn.text ?? ''}` }
  }
  if (turn.role === 'assistant') {
    const tools = turn.toolCalls?.length
      ? `(Tools called: ${turn.toolCalls.map((c) => c.name).join(', ')})`
      : ''
    const text = [turn.text?.trim(), tools].filter(Boolean).join('\n')
    return text ? { role: 'assistant', text } : null
  }
  // App notes (proposal decisions) are 'tool' turns with a proposalId and text but no toolResult.
  if (turn.proposalId && turn.text && !turn.toolResult) {
    return { role: 'user', text: `[App note] ${turn.text}` }
  }
  return null
}

export interface HistoryOptions {
  maxTurns?: number
  /** Estimated tokens for the whole history. */
  budgetTokens?: number
}

/**
 * Previous turns as chat messages, newest kept first within `maxTurns` and `budgetTokens`. Tool call details and
 * images are never replayed (only the latest texture state is sent). Dropped turns are replaced by one summary.
 */
export function historyMessages(
  turns: ConversationTurn[],
  { maxTurns = 30, budgetTokens = 6000 }: HistoryOptions = {}
): ChatMessage[] {
  const all = turns.map((t) => ({ turn: t, msg: turnMessage(t) })).filter((e) => e.msg !== null)
  const kept: ChatMessage[] = []
  let used = 0
  let i = all.length - 1
  for (; i >= 0 && kept.length < maxTurns; i--) {
    const cost = messageTokens(all[i].msg!)
    if (used + cost > budgetTokens) break
    used += cost
    kept.unshift(all[i].msg!)
  }
  if (i >= 0) {
    const dropped = all.slice(0, i + 1)
    const requests = dropped
      .filter((e) => e.turn.role === 'user')
      .slice(-5)
      .map((e) => `"${clip(e.turn.text ?? '', 80)}"`)
    kept.unshift({
      role: 'user',
      text: `[App note] ${dropped.length} earlier message(s) omitted.${
        requests.length ? ` Earlier user requests: ${requests.join(', ')}.` : ''
      }`
    })
  }
  return kept
}

/** Copies of `messages` where only the most recent message with images keeps them. */
export function latestImageOnly(messages: ChatMessage[]): ChatMessage[] {
  let last = -1
  messages.forEach((m, i) => {
    if (m.images?.length) last = i
  })
  return messages.map((m, i) => {
    if (!m.images || i === last) return m
    const copy = { ...m }
    delete copy.images
    return copy
  })
}
