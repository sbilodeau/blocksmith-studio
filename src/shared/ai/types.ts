/**
 * AI contracts shared by main (providers, agent runtime) and renderer (AI panel). PLAN sections 6 and 7.
 * API keys never appear in these types: they live in main's encrypted secrets store.
 */
import type { Language } from '../model/settings'
import type { StyleBriefPatch } from '../model/brief'
import type { BulkItem } from '../model/bulk'
import type { CustomItem } from '../items/schema'

// ---------- providers and models ----------
export type ProviderKind = 'ollama' | 'openai-compatible'

export interface ProviderConfig {
  id: string
  kind: ProviderKind
  label: string
  /** e.g. https://ollama.com (Ollama Cloud native API) or https://api.openai.com/v1 */
  baseUrl: string
  enabled: boolean
  extraHeaders?: Record<string, string>
}

/** What the renderer sees about a provider: never the key itself. */
export interface ProviderStatus extends ProviderConfig {
  hasKey: boolean
  /** False for loopback providers (self-hosted Ollama on localhost), which work without a key. */
  keyRequired: boolean
}

export interface ModelCapabilities {
  vision?: boolean
  tools?: boolean
  thinking?: boolean
}

export interface ModelInfo {
  id: string
  providerId: string
  label: string
  capabilities: ModelCapabilities
  /** Where capabilities came from: the provider API, the built-in hint table, or a user override. */
  capabilitySource?: 'provider' | 'hint' | 'user'
  contextLength?: number
  pricing?: { inPerMTok: number; outPerMTok: number; source: 'provider' | 'hint' | 'user' }
  /** $ / $$ / $$$ from the blended price (PLAN 7.4); absent when the price is unknown. */
  costTier?: 1 | 2 | 3
}

export interface ModelRef {
  providerId: string
  modelId: string
}

// ---------- normalized chat (adapters convert to/from each provider's wire format) ----------
export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  text?: string
  /** PNG bytes. */
  images?: Uint8Array[]
  thinking?: string
  toolCalls?: ToolCall[]
  /** For role 'tool': the call this result answers. */
  toolCallId?: string
  toolName?: string
}

/** Tool definition sent to the model (JSON Schema parameters generated from zod). */
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  tools?: ToolSpec[]
  /**
   * Reasoning for thinking models: false = off, true = on, or a level. Adapters map levels to what the model
   * accepts (a level for models that support levels, else on). Ignored by models that cannot think.
   */
  think?: boolean | 'low' | 'medium' | 'high'
  temperature?: number
}

export type ChatEvent =
  | { type: 'thinking'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: 'done'; stopReason: 'end' | 'tool_calls' | 'length' }

export interface ProviderAdapter {
  readonly providerId: string
  listModels(): Promise<ModelInfo[]>
  /** Streams normalized events. Throws AppError-like errors (code 'ai.*') on HTTP/network failures. */
  chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>
}

// ---------- agents ----------
/**
 * `data`: the chat of the data editor, about the open data file (M10). `item`: the chat of the item page, about the
 * open custom item (M14).
 */
export type AgentKind = 'creation' | 'navigation' | 'editor' | 'data' | 'item'

export type ImageMode = 'vision+grid' | 'grid' | 'image'

export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high'

export interface AgentSettings {
  model?: ModelRef
  thinking: ReasoningLevel
  /** Max model round trips (tool loops) per user request. */
  maxIterations: number
  imageMode: ImageMode
}

/** A request to the editor agent about the texture open in the editor. */
export interface EditorAgentRequest {
  packId: string
  message: string
  model: ModelRef
  /**
   * Pack path of the open texture and its CURRENT pixels (may include unsaved edits). An animated texture is the
   * whole strip, with its frame height and the frame the user is editing.
   */
  texture: { path: string; png: Uint8Array; animation?: TextureAnimation }
  language: Language
  /** Reasoning level for this request (the AI tab's selector); defaults to the agent setting. */
  thinking?: ReasoningLevel
}

/** Animated texture sent to the editor agent: a vertical strip of full-width frames. */
export interface TextureAnimation {
  frameHeight: number
  /** Frame the user is editing (0-based). */
  frame: number
}

/** A request to the creation agent about the whole pack (PLAN 6.3, M6). */
export interface CreationAgentRequest {
  packId: string
  message: string
  model: ModelRef
  language: Language
  thinking?: ReasoningLevel
}

/**
 * "Explain" in the data editor (PLAN M10): a one-shot model answer, without tools, that describes in plain words what
 * a data file does in game compared with vanilla's. `text` is the editor's text (unsaved edits included).
 */
export interface DataExplainRequest {
  packId: string
  path: string
  text: string
  model: ModelRef
  language: Language
  thinking?: ReasoningLevel
}

/** A chat message to the data agent about the file open in the data editor (`text`: the editor's text). */
export interface DataAgentRequest {
  packId: string
  message: string
  model: ModelRef
  path: string
  text: string
  language: Language
  thinking?: ReasoningLevel
}

/**
 * A chat message to the item agent about the custom item open in the item page (M14). `item` is the form's definition,
 * unsaved edits included (it may not be valid yet: main checks it); `id` is the id the item is saved under.
 */
export interface ItemAgentRequest {
  packId: string
  id: string
  item: Record<string, unknown>
  message: string
  model: ModelRef
  language: Language
  thinking?: ReasoningLevel
}

/** "Explain" in the item page (M14): one answer, without tools, about what the open item does in game. */
export interface ItemExplainRequest {
  packId: string
  id: string
  item: Record<string, unknown>
  model: ModelRef
  language: Language
  thinking?: ReasoningLevel
}

/** A request to the navigation agent about the grid selection. */
export interface NavigationAgentRequest {
  packId: string
  message: string
  model: ModelRef
  /** Pack paths of the selected textures. */
  paths: string[]
  language: Language
  thinking?: ReasoningLevel
}

export type ToolKind = 'read' | 'mutate' | 'memory'

/** One proposed change, computed on a draft (never applied to files until the user accepts). */
export interface ProposalStep {
  id: string
  callId: string
  tool: string
  args: unknown
  kind: ToolKind
  /** Localized summary for the plan UI: i18n key under `ops.*` and its params. */
  description: { key: string; params: Record<string, string | number> }
  /** Earlier steps this one was computed on top of. */
  dependsOn: string[]
  /** Texture after this step (mutate steps); absent for memory steps. */
  previewPng?: Uint8Array
  /** Memory steps (style brief updates): the proposed patch. */
  briefPatch?: StyleBriefPatch
  /** Bulk steps (navigation agent): textures of the selection the step changed. */
  targets?: string[]
  /** Creation agent apply_to_all: which textures of the pack the step covers (shown in the plan). */
  scope?: PlanScope
  /** Creation agent apply_to_all: a few representative textures before / after this step. */
  samples?: BulkItem[]
  /** Creation agent set_pack_meta: the proposed name and/or description. */
  packMeta?: PackMetaPatch
  /** Creation agent write_json: the proposed data file. */
  json?: JsonFileChange
  /** Animated texture: the frame the step changes (0-based), or 'all' for every frame. */
  frame?: number | 'all'
  /** Creation agent write_item / delete_item (M14): the custom item written or deleted. */
  item?: ItemStepChange
}

/** A custom item proposed by the creation agent (applied with the plan's other items as one history entry). */
export interface ItemStepChange {
  op: 'write' | 'delete'
  /** Id of the item written or deleted. */
  id: string
  /** The whole definition (write). */
  item?: CustomItem
  /** New item: the vanilla or pack texture its texture copies. */
  textureFrom?: string
  /** True when the pack has no item with this id yet (write). */
  isNew?: boolean
}

/** Filter of a creation-agent step (categories AND folders AND name glob) and how many textures it matched. */
export interface PlanScope {
  categories?: string[]
  folders?: string[]
  match?: string
  /** Matched textures in total and per category id. */
  count: number
  byCategory: Record<string, number>
}

/** A data file proposed by write_json (applied with the plan's other files as one history entry). */
export interface JsonFileChange {
  path: string
  /** Whole new file text (pretty JSON). */
  text: string
  /** Text before the plan (the pack's or vanilla's file); null for a new file. */
  previous: string | null
  /** "Unknown item" style warnings the check found (errors refuse the file). */
  warnings: number
}

export interface PackMetaPatch {
  name?: string
  description?: string
}

export interface Proposal {
  id: string
  runId: string
  agent: AgentKind
  packId: string
  texturePath: string
  /** Texture before the first step. */
  basePng: Uint8Array
  /** Animated texture: steps with a `frame` replay on that frame (or every frame). */
  animation?: TextureAnimation
  steps: ProposalStep[]
  status: 'pending' | 'applied' | 'partially-applied' | 'rejected'
}

/**
 * A navigation-agent plan over a selection: its steps (bulk operations and style brief updates) and the
 * textures they change, before / after all steps, for the review grid with per-texture toggles.
 */
export interface BulkProposal {
  id: string
  runId: string
  agent: 'navigation'
  kind: 'bulk'
  packId: string
  steps: ProposalStep[]
  items: BulkItem[]
  status: Proposal['status']
}

/**
 * A creation-agent plan over the whole pack: category-by-category operations (applied in chunks, one history entry
 * per step), style brief updates and pack name / description changes. Reviewed step by step (with samples), not
 * texture by texture.
 */
export interface CreationProposal {
  id: string
  runId: string
  agent: 'creation'
  kind: 'plan'
  packId: string
  steps: ProposalStep[]
  status: Proposal['status']
}

/**
 * A data-agent proposal (M10): the whole new text of the open data file. Applying it puts the text in the editor,
 * unsaved: the user reviews it there and saves (one history entry), so nothing is written by the AI.
 */
export interface DataFileProposal {
  id: string
  runId: string
  agent: 'data'
  kind: 'file'
  packId: string
  path: string
  /** The editor text the agent started from. */
  before: string
  /** The proposed text (checked: no errors). */
  after: string
  warnings: number
  status: 'pending' | 'applied' | 'rejected'
}

/**
 * An item-agent proposal (M14): the whole new definition of the open custom item, checked against the schema.
 * Applying it puts the definition in the item form, unsaved: the user's save writes it (one history entry).
 */
export interface ItemDefinitionProposal {
  id: string
  runId: string
  agent: 'item'
  kind: 'item'
  packId: string
  /** Id the item is saved under (the request's). */
  itemId: string
  /** The form's definition the agent started from. */
  before: Record<string, unknown>
  /** The proposed definition (valid). */
  after: CustomItem
  /** Item ids and tags of the proposal this Minecraft version does not have. */
  unknownIds: string[]
  status: 'pending' | 'applied' | 'rejected'
}

/** Proposals kept in main until applied (data and item proposals are applied in the renderer and never stored). */
export type AnyProposal = Proposal | BulkProposal | CreationProposal

/** Any proposal an agent run can emit. */
export type EmittedProposal = AnyProposal | DataFileProposal | ItemDefinitionProposal

export function isBulkProposal(p: AnyProposal): p is BulkProposal {
  return (p as BulkProposal).kind === 'bulk'
}

export function isCreationProposal(p: AnyProposal): p is CreationProposal {
  return (p as CreationProposal).kind === 'plan'
}

export function isDataFileProposal(p: EmittedProposal): p is DataFileProposal {
  return (p as DataFileProposal).kind === 'file'
}

export function isItemProposal(p: EmittedProposal): p is ItemDefinitionProposal {
  return (p as ItemDefinitionProposal).kind === 'item'
}

export interface CreationApplyResult {
  appliedStepIds: string[]
  /** Texture writes over all steps (a texture changed by two steps counts twice). */
  texturesWritten: number
  /** History entries written (one per texture step that changed something). */
  checkpoints: number
  /** The user pressed Stop: the remaining texture steps were not applied. */
  stopped: boolean
  briefUpdated: boolean
  metaUpdated: boolean
  /** Data files written by write_json steps (one history entry for all of them). */
  filesWritten: number
  /** Custom items written or deleted by write_item / delete_item steps (one history entry for all of them). */
  itemsWritten: number
}

export interface BulkProposalApplyResult {
  /** Textures written (one history entry). */
  applied: number
  appliedStepIds: string[]
  briefUpdated: boolean
}

export interface ProposalApplyResult {
  /** Texture after replaying the accepted mutate steps on the base image (put into the editor as one edit). */
  png: Uint8Array
  appliedStepIds: string[]
  briefUpdated: boolean
}

/** Result of Settings > "Test this model" (FR/EN evaluation, PLAN 6.8). */
export interface EvalScore {
  total: number
  passed: number
  /** 0-100. */
  rate: number
}

export interface EvalReport {
  model: ModelRef
  overall: EvalScore
  fr: EvalScore
  en: EvalScore
  /** |FR - EN| in percentage points. */
  gap: number
  /** Meets the thresholds (90% overall, gap <= 10 points). */
  ok: boolean
  avgLatencyMs: number
  inputTokens: number
  outputTokens: number
  /** Total cost in USD when known (provider cost or the model's price). */
  costUsd?: number
  /** Stopped before every request ran. */
  stopped: boolean
  failures: Array<{
    caseId: string
    language: 'fr' | 'en'
    phrase: string
    calls: string
    error?: string
  }>
  markdown: string
}

export interface EvalProgress {
  done: number
  total: number
  caseId: string
  language: 'fr' | 'en'
  pass: boolean
}

export type AgentEvent =
  | { runId: string; type: 'started'; agent: AgentKind | 'explain'; model: ModelRef }
  | { runId: string; type: 'thinking'; delta: string }
  | { runId: string; type: 'text'; delta: string }
  | { runId: string; type: 'tool_call'; call: ToolCall; kind: ToolKind; iteration: number }
  | { runId: string; type: 'tool_result'; callId: string; ok: boolean; summary: string }
  | { runId: string; type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { runId: string; type: 'proposal'; proposal: EmittedProposal }
  | {
      runId: string
      type: 'done'
      reason: 'end' | 'budget' | 'stopped' | 'error'
      error?: { code: string; params?: Record<string, string | number> }
    }

/** One persisted line of an agent conversation (.blocksmith/conversations/<agent>.jsonl). */
export interface ConversationTurn {
  id: string
  at: string
  role: 'user' | 'assistant' | 'tool'
  text?: string
  thinking?: string
  toolCalls?: ToolCall[]
  toolResult?: { callId: string; ok: boolean; summary: string }
  /** Texture the user message was about. */
  texturePath?: string
  /** Data file the user message was about (data agent). */
  dataPath?: string
  /** Custom item the user message was about (item agent). */
  itemId?: string
  model?: ModelRef
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number }
  proposalId?: string
}
