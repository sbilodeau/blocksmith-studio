import type { AgentEvent, AgentKind, AgentSettings } from '@shared/ai/types'
import type { PreviewModel } from '@shared/model/preview'
import { handle } from './registry'
import type { ProviderRegistry } from '../services/contracts'
import { createBriefService, type BriefService } from '../services/brief'
import {
  createConversationStore,
  createEditorAgentService,
  type EditorAgentService,
  type EditorAgentServiceDeps,
  type DataAiDeps
} from '../services/ai/agent'

export interface AiAgentHandlerDeps {
  providers: ProviderRegistry
  /** Current per-agent settings (settings.ai.agents[agent]). */
  getAgentSettings: (agent: AgentKind) => AgentSettings
  packs: { locate: (packId: string) => Promise<{ folder: string } | null> }
  /** Vanilla PNG of a pack texture, or null when it has none (get_texture). */
  readVanillaPng: (packId: string, path: string) => Promise<Uint8Array | null>
  /** 3D preview model of a texture, so the agent knows which pixels are which body part / block face. */
  previewModel?: (packId: string, path: string) => Promise<PreviewModel | null>
  /** Navigation agent: pack textures, their current PNG and the bulk service (omitted in some tests). */
  navigation?: EditorAgentServiceDeps['navigation']
  /** Creation agent: pack name / description and plan progress (needs `navigation`). */
  creation?: EditorAgentServiceDeps['creation']
  /** "Explain" in the data editor (M10). */
  dataAi?: DataAiDeps
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
    previewModel: deps.previewModel,
    ...(deps.navigation ? { navigation: deps.navigation } : {}),
    ...(deps.creation ? { creation: deps.creation } : {}),
    ...(deps.dataAi ? { dataAi: deps.dataAi } : {}),
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
  handle('ai.navigation.send', (request) => agent.sendNavigation(request))
  handle('ai.navigation.apply', ({ proposalId, acceptedStepIds, acceptedPaths }) =>
    agent.applyNavigation(proposalId, acceptedStepIds, acceptedPaths)
  )
  handle('ai.creation.send', (request) => agent.sendCreation(request))
  handle('ai.creation.apply', ({ proposalId, acceptedStepIds }) =>
    agent.applyCreation(proposalId, acceptedStepIds)
  )
  handle('ai.creation.stopApply', ({ proposalId }) => agent.stopCreationApply(proposalId))
  handle('ai.data.send', (request) => agent.sendData(request))
  handle('ai.data.explain', (request) => agent.sendExplain(request))
  handle('brief.get', ({ packId }) => brief.get(packId))
  handle('brief.update', ({ packId, patch }) => brief.update(packId, patch, 'user'))

  return { agent, brief }
}
