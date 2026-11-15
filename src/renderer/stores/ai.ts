import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  AgentEvent,
  AgentKind,
  ConversationTurn,
  ModelInfo,
  ModelRef,
  Proposal,
  ProposalApplyResult,
  ProviderConfig,
  ProviderStatus,
  ToolCall,
  ToolKind
} from '@shared/ai/types'
import type { Language } from '@shared/model/settings'
import { call } from '../services/ipc'

/** One message bubble in the AI panel, built from persisted turns and live events. */
export interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  text: string
  thinking: string
  toolCalls: Array<{ call: ToolCall; kind?: ToolKind; result?: { ok: boolean; summary: string } }>
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number }
  proposalId?: string
  error?: { code: string; params?: Record<string, string | number> }
  streaming?: boolean
}

export interface AgentSession {
  key: string
  items: ChatItem[]
  runId: string | null
  proposals: Record<string, Proposal>
  loaded: boolean
}

function sessionKey(packId: string, agent: AgentKind): string {
  return `${packId}:${agent}`
}

let itemSeq = 0
const nextId = (): string => `item-${Date.now()}-${itemSeq++}`

/** Converts persisted conversation turns into chat bubbles (tool turns are folded into the assistant bubble). */
export function turnsToItems(turns: ConversationTurn[]): ChatItem[] {
  const items: ChatItem[] = []
  for (const turn of turns) {
    if (turn.role === 'user') {
      items.push({ id: turn.id, role: 'user', text: turn.text ?? '', thinking: '', toolCalls: [] })
      continue
    }
    let last = items[items.length - 1]
    if (!last || last.role !== 'assistant') {
      last = { id: turn.id, role: 'assistant', text: '', thinking: '', toolCalls: [] }
      items.push(last)
    }
    if (turn.role === 'assistant') {
      if (turn.text) last.text += (last.text ? '\n' : '') + turn.text
      if (turn.thinking) last.thinking += turn.thinking
      for (const c of turn.toolCalls ?? []) last.toolCalls.push({ call: c })
      if (turn.usage) last.usage = turn.usage
      if (turn.proposalId) last.proposalId = turn.proposalId
    } else if (turn.toolResult) {
      const entry = last.toolCalls.find((t) => t.call.id === turn.toolResult!.callId)
      if (entry) entry.result = { ok: turn.toolResult.ok, summary: turn.toolResult.summary }
    }
  }
  return items
}

export const useAiStore = defineStore('ai', () => {
  const providers = ref<ProviderStatus[]>([])
  const models = ref<ModelInfo[]>([])
  const modelsLoading = ref(false)
  const modelsError = ref<string | null>(null)
  const sessions = ref<Record<string, AgentSession>>({})
  /** runId -> session key, to route events. */
  const runs = new Map<string, string>()
  let listening = false

  const hasUsableProvider = computed(() =>
    providers.value.some((p) => p.enabled && (p.hasKey || !p.keyRequired))
  )
  const toolModels = computed(() => models.value.filter((m) => m.capabilities.tools !== false))

  function init(): void {
    if (listening) return
    listening = true
    window.blocksmith.on('ai.event', onEvent)
  }

  async function loadProviders(): Promise<void> {
    providers.value = await call('ai.providers.list')
  }

  async function loadModels(refresh = false): Promise<void> {
    modelsLoading.value = true
    modelsError.value = null
    try {
      models.value = await call('ai.models.list', { refresh })
    } catch (err) {
      modelsError.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      modelsLoading.value = false
    }
  }

  async function saveProvider(config: ProviderConfig): Promise<void> {
    providers.value = await call('ai.providers.save', config)
  }

  async function deleteProvider(providerId: string): Promise<void> {
    providers.value = await call('ai.providers.delete', { providerId })
  }

  async function setKey(providerId: string, key: string): Promise<void> {
    const updated = await call('ai.providers.setKey', { providerId, key })
    providers.value = providers.value.map((p) => (p.id === providerId ? updated : p))
  }

  function testProvider(providerId: string): Promise<{
    ok: boolean
    modelCount?: number
    error?: { code: string; params?: Record<string, string | number> }
  }> {
    return call('ai.providers.test', { providerId })
  }

  function findModel(ref: ModelRef | undefined): ModelInfo | undefined {
    if (!ref) return undefined
    return models.value.find((m) => m.providerId === ref.providerId && m.id === ref.modelId)
  }

  // ---------- sessions ----------
  function session(packId: string, agent: AgentKind): AgentSession {
    const key = sessionKey(packId, agent)
    if (!sessions.value[key]) {
      sessions.value[key] = { key, items: [], runId: null, proposals: {}, loaded: false }
    }
    return sessions.value[key]
  }

  async function loadConversation(packId: string, agent: AgentKind): Promise<void> {
    const s = session(packId, agent)
    const turns = await call('ai.agent.conversation', { packId, agent })
    s.items = turnsToItems(turns)
    s.loaded = true
  }

  async function clearConversation(packId: string, agent: AgentKind): Promise<void> {
    await call('ai.agent.clear', { packId, agent })
    const s = session(packId, agent)
    s.items = []
    s.proposals = {}
  }

  async function sendEditor(args: {
    packId: string
    message: string
    model: ModelRef
    texture: { path: string; png: Uint8Array }
    language: Language
  }): Promise<void> {
    const s = session(args.packId, 'editor')
    s.items.push({ id: nextId(), role: 'user', text: args.message, thinking: '', toolCalls: [] })
    s.items.push({
      id: nextId(),
      role: 'assistant',
      text: '',
      thinking: '',
      toolCalls: [],
      streaming: true
    })
    const { runId } = await call('ai.agent.send', {
      ...args,
      texture: { path: args.texture.path, png: new Uint8Array(args.texture.png) }
    })
    s.runId = runId
    runs.set(runId, s.key)
  }

  async function stop(packId: string, agent: AgentKind): Promise<void> {
    const s = session(packId, agent)
    if (s.runId) await call('ai.agent.stop', { runId: s.runId })
  }

  function currentAssistant(s: AgentSession): ChatItem {
    let last = s.items[s.items.length - 1]
    if (!last || last.role !== 'assistant') {
      last = {
        id: nextId(),
        role: 'assistant',
        text: '',
        thinking: '',
        toolCalls: [],
        streaming: true
      }
      s.items.push(last)
    }
    return last
  }

  function onEvent(e: AgentEvent): void {
    const key = runs.get(e.runId)
    if (!key) return
    const s = sessions.value[key]
    if (!s) return
    const item = currentAssistant(s)
    switch (e.type) {
      case 'thinking':
        item.thinking += e.delta
        break
      case 'text':
        item.text += e.delta
        break
      case 'tool_call':
        item.toolCalls.push({ call: e.call, kind: e.kind })
        break
      case 'tool_result': {
        const entry = item.toolCalls.find((t) => t.call.id === e.callId)
        if (entry) entry.result = { ok: e.ok, summary: e.summary }
        break
      }
      case 'usage':
        item.usage = {
          inputTokens: (item.usage?.inputTokens ?? 0) + (e.inputTokens ?? 0),
          outputTokens: (item.usage?.outputTokens ?? 0) + (e.outputTokens ?? 0),
          costUsd:
            e.costUsd !== undefined ? (item.usage?.costUsd ?? 0) + e.costUsd : item.usage?.costUsd
        }
        break
      case 'proposal':
        s.proposals[e.proposal.id] = e.proposal
        item.proposalId = e.proposal.id
        break
      case 'done':
        item.streaming = false
        if (e.reason === 'error' && e.error) item.error = e.error
        if (e.reason === 'budget') item.error = { code: 'ai.budgetReached' }
        if (e.reason === 'stopped') item.error = { code: 'ai.stopped' }
        s.runId = null
        runs.delete(e.runId)
        break
      case 'started':
        break
    }
  }

  async function applyProposal(
    packId: string,
    proposalId: string,
    acceptedStepIds: string[]
  ): Promise<ProposalApplyResult> {
    const result = await call('ai.proposal.apply', { proposalId, acceptedStepIds })
    const p = session(packId, 'editor').proposals[proposalId]
    if (p) {
      p.status = result.appliedStepIds.length === p.steps.length ? 'applied' : 'partially-applied'
    }
    return result
  }

  async function rejectProposal(packId: string, proposalId: string): Promise<void> {
    await call('ai.proposal.reject', { proposalId })
    const p = session(packId, 'editor').proposals[proposalId]
    if (p) p.status = 'rejected'
  }

  return {
    providers,
    models,
    modelsLoading,
    modelsError,
    sessions,
    hasUsableProvider,
    toolModels,
    init,
    loadProviders,
    loadModels,
    saveProvider,
    deleteProvider,
    setKey,
    testProvider,
    findModel,
    session,
    loadConversation,
    clearConversation,
    sendEditor,
    stop,
    applyProposal,
    rejectProposal,
    onEvent
  }
})
