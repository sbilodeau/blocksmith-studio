import type { AgentEvent, AgentKind, AgentSettings } from '@shared/ai/types'
import { handle } from './registry'
import type { ProviderRegistry } from '../services/contracts'
import { createBriefService, type BriefService } from '../services/brief'
import {
  createConversationStore,
  createEditorAgentService,
  type EditorAgentService
} from '../services/ai/agent'

export interface AiAgentHandlerDeps {
  providers: ProviderRegistry
  /** Current per-agent settings (settings.ai.agents[agent]). */
  getAgentSettings: (agent: AgentKind) => AgentSettings
  packs: { locate: (packId: string) => Promise<{ folder: string } | null> }
  /** Vanilla PNG of a pack texture, or null when it has none (get_texture). */
  readVanillaPng: (packId: string, path: string) => Promise<Uint8Array | null>
  /** Main forwards these to the window as 'ai.event'. */
  emit: (event: AgentEvent) => void
  now?: () => Date
  newId?: () => string
}

/** Editor agent, proposals and style brief channels. Returns the services (tests, shutdown). */
export function registerAiAgentHandlers(deps: AiAgentHandlerDeps): {
  agent: EditorAgentService
  brief: BriefService
} {
  const locate = (packId: string): Promise<{ folder: string } | null> => deps.packs.locate(packId)
  const brief = createBriefService({ locate, now: deps.now })
  const conversations = createConversationStore({ locate })
  const agent = createEditorAgentService({
    providers: deps.providers,
    getAgentSettings: deps.getAgentSettings,
    packs: { locate },
    brief,
    conversations,
    readVanillaPng: deps.readVanillaPng,
    emit: deps.emit,
    now: deps.now,
    newId: deps.newId
  })

  handle('ai.agent.send', (request) => agent.send(request))
  handle('ai.agent.stop', ({ runId }) => agent.stop(runId))
  handle('ai.agent.conversation', ({ packId, agent: kind }) => agent.conversation(packId, kind))
  handle('ai.agent.clear', ({ packId, agent: kind }) => agent.clear(packId, kind))
  handle('ai.proposal.apply', ({ proposalId, acceptedStepIds }) =>
    agent.applyProposal(proposalId, acceptedStepIds)
  )
  handle('ai.proposal.reject', ({ proposalId }) => agent.rejectProposal(proposalId))
  handle('brief.get', ({ packId }) => brief.get(packId))
  handle('brief.update', ({ packId, patch }) => brief.update(packId, patch, 'user'))

  return { agent, brief }
}
