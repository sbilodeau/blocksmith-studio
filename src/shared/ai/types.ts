/**
 * AI contracts shared by main (providers, agent runtime) and renderer (AI panel). PLAN sections 6 and 7.
 * API keys never appear in these types: they live in main's encrypted secrets store.
 */
import type { Language } from '../model/settings'
import type { StyleBriefPatch } from '../model/brief'

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
  /** Ask for reasoning output when the model supports it. */
  think?: boolean
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
export type AgentKind = 'creation' | 'navigation' | 'editor'

export type ImageMode = 'vision+grid' | 'grid' | 'image'

export interface AgentSettings {
  model?: ModelRef
  thinking: boolean
  /** Max model round trips (tool loops) per user request. */
  maxIterations: number
  imageMode: ImageMode
}

/** A request to the editor agent about the texture open in the editor. */
export interface EditorAgentRequest {
  packId: string
  message: string
  model: ModelRef
  /** Pack path of the open texture and its CURRENT pixels (may include unsaved edits). */
  texture: { path: string; png: Uint8Array }
  language: Language
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
}

export interface Proposal {
  id: string
  runId: string
  agent: AgentKind
  packId: string
  texturePath: string
  /** Texture before the first step. */
  basePng: Uint8Array
  steps: ProposalStep[]
  status: 'pending' | 'applied' | 'partially-applied' | 'rejected'
}

export interface ProposalApplyResult {
  /** Texture after replaying the accepted mutate steps on the base image (put into the editor as one edit). */
  png: Uint8Array
  appliedStepIds: string[]
  briefUpdated: boolean
}

export type AgentEvent =
  | { runId: string; type: 'started'; agent: AgentKind; model: ModelRef }
  | { runId: string; type: 'thinking'; delta: string }
  | { runId: string; type: 'text'; delta: string }
  | { runId: string; type: 'tool_call'; call: ToolCall; kind: ToolKind; iteration: number }
  | { runId: string; type: 'tool_result'; callId: string; ok: boolean; summary: string }
  | { runId: string; type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { runId: string; type: 'proposal'; proposal: Proposal }
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
  model?: ModelRef
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number }
  proposalId?: string
}
