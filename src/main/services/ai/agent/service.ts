import { randomUUID } from 'node:crypto'
import { decodePng, type RgbaImage } from '@shared/image'
import type {
  AgentEvent,
  AgentKind,
  AgentSettings,
  ConversationTurn,
  EditorAgentRequest,
  Proposal,
  ProposalApplyResult
} from '@shared/ai/types'
import type { ProviderRegistry } from '../../contracts'
import { AppErrorException } from '../../../ipc/registry'
import type { BriefService } from '../../brief'
import type { ConversationStore } from './conversation'
import { ProposalStore, decisionNote, replayProposal, requestSummary } from './proposals'
import { errorOf, runEditorAgent } from './runtime'

/** Largest texture side the agent accepts. */
export const MAX_AGENT_TEXTURE_SIDE = 1024

export interface EditorAgentServiceDeps {
  providers: ProviderRegistry
  getAgentSettings: (agent: AgentKind) => AgentSettings
  packs: { locate: (packId: string) => Promise<unknown | null> }
  brief: BriefService
  conversations: ConversationStore
  /** Vanilla PNG of a pack texture (for get_texture), or null when it has none. */
  readVanillaPng: (packId: string, path: string) => Promise<Uint8Array | null>
  /** Default sink for background runs (main forwards it as 'ai.event'). */
  emit: (event: AgentEvent) => void
  now?: () => Date
  newId?: () => string
  tokenBudget?: number
  proposalTtlMs?: number
}

export interface EditorAgentService {
  /** Validates, then starts a run in the background (stopping the pack's previous editor run). */
  send(request: EditorAgentRequest): Promise<{ runId: string }>
  /** Runs to completion: events, proposal, conversation persistence. Never throws. */
  run(
    request: EditorAgentRequest,
    emit: (event: AgentEvent) => void,
    signal: AbortSignal,
    runId?: string
  ): Promise<void>
  stop(runId: string): void
  conversation(packId: string, agent: AgentKind): Promise<ConversationTurn[]>
  clear(packId: string, agent: AgentKind): Promise<void>
  applyProposal(proposalId: string, acceptedStepIds: string[]): Promise<ProposalApplyResult>
  rejectProposal(proposalId: string): Promise<void>
  /** Resolves when no background run is active (tests, shutdown). */
  idle(): Promise<void>
}

interface ActiveRun {
  runId: string
  controller: AbortController
  done: Promise<void>
}

export function createEditorAgentService(deps: EditorAgentServiceDeps): EditorAgentService {
  const now = deps.now ?? ((): Date => new Date())
  const newId = deps.newId ?? ((): string => randomUUID())
  const proposals = new ProposalStore(() => now().getTime(), deps.proposalTtlMs)
  /** Active run per "packId:agent". */
  const active = new Map<string, ActiveRun>()
  const byRunId = new Map<string, ActiveRun>()

  function decode(png: Uint8Array): RgbaImage {
    let img: RgbaImage
    try {
      img = decodePng(png)
    } catch {
      throw new AppErrorException('ai.invalidTexture')
    }
    if (img.width > MAX_AGENT_TEXTURE_SIDE || img.height > MAX_AGENT_TEXTURE_SIDE) {
      throw new AppErrorException('ai.textureTooLarge', { max: MAX_AGENT_TEXTURE_SIDE })
    }
    return img
  }

  async function readVanilla(packId: string, path: string): Promise<RgbaImage | null> {
    try {
      const png = await deps.readVanillaPng(packId, path)
      return png ? decodePng(png) : null
    } catch {
      return null
    }
  }

  async function run(
    request: EditorAgentRequest,
    emit: (event: AgentEvent) => void,
    signal: AbortSignal,
    runId = newId()
  ): Promise<void> {
    const { packId } = request
    emit({ runId, type: 'started', agent: 'editor', model: request.model })
    let result: Awaited<ReturnType<typeof runEditorAgent>>
    let proposal: Proposal | undefined
    try {
      const base = decode(request.texture.png)
      proposals.expireFor(packId, 'editor')
      const [brief, vanilla, history] = await Promise.all([
        deps.brief.get(packId),
        readVanilla(packId, request.texture.path),
        deps.conversations.read(packId, 'editor')
      ])
      const userTurn: ConversationTurn = {
        id: newId(),
        at: now().toISOString(),
        role: 'user',
        text: request.message,
        texturePath: request.texture.path,
        model: request.model
      }
      await deps.conversations.append(packId, 'editor', [userTurn])
      result = await runEditorAgent(
        {
          runId,
          request,
          base,
          settings: deps.getAgentSettings('editor'),
          brief,
          vanilla,
          history
        },
        { providers: deps.providers, newId, now, tokenBudget: deps.tokenBudget },
        emit,
        signal
      )
      if (result.steps.length > 0) {
        proposal = {
          id: newId(),
          runId,
          agent: 'editor',
          packId,
          texturePath: request.texture.path,
          basePng: request.texture.png,
          steps: result.steps,
          status: 'pending'
        }
        proposals.add(proposal, request.message)
        const last = [...result.turns].reverse().find((t) => t.role === 'assistant')
        if (last) last.proposalId = proposal.id
      }
      await deps.conversations.append(packId, 'editor', result.turns).catch(() => undefined)
    } catch (err) {
      emit({ runId, type: 'done', reason: 'error', error: errorOf(err) })
      return
    }
    if (proposal) emit({ runId, type: 'proposal', proposal })
    emit({
      runId,
      type: 'done',
      reason: result.reason,
      ...(result.error ? { error: result.error } : {})
    })
  }

  function stopKey(key: string): void {
    active.get(key)?.controller.abort()
  }

  return {
    async send(request) {
      // Fail fast on what the renderer can fix; everything else is reported through 'ai.event'.
      decode(request.texture.png)
      if (!(await deps.packs.locate(request.packId))) {
        throw new AppErrorException('packs.notFound', { packId: request.packId })
      }
      const key = `${request.packId}:editor`
      const previous = active.get(key)
      previous?.controller.abort()
      const runId = newId()
      const controller = new AbortController()
      const entry: ActiveRun = {
        runId,
        controller,
        done: (async (): Promise<void> => {
          await previous?.done
          await run(request, deps.emit, controller.signal, runId)
        })().finally(() => {
          if (active.get(key) === entry) active.delete(key)
          byRunId.delete(runId)
        })
      }
      active.set(key, entry)
      byRunId.set(runId, entry)
      return { runId }
    },

    run,

    stop(runId) {
      byRunId.get(runId)?.controller.abort()
    },

    conversation: (packId, agent) => deps.conversations.read(packId, agent),

    async clear(packId, agent) {
      stopKey(`${packId}:${agent}`)
      await active.get(`${packId}:${agent}`)?.done
      proposals.expireFor(packId, agent)
      await deps.conversations.clear(packId, agent)
    },

    async applyProposal(proposalId, acceptedStepIds) {
      const item = proposals.getPending(proposalId)
      const { proposal } = item
      const brief = await deps.brief.get(proposal.packId)
      const replay = replayProposal(proposal, acceptedStepIds, brief)
      const { applied, patches } = replay
      if (applied.length > 0) {
        const decided = patches.some((p) => p.addDecision?.trim())
        const fields = [...new Set(patches.flatMap((p) => Object.keys(p)))].join(', ')
        await deps.brief.change(proposal.packId, {
          patches,
          by: proposal.agent,
          ...(patches.length && !decided
            ? { decision: `Style brief change accepted by the user (${fields})` }
            : {}),
          requestLog: { agent: proposal.agent, summary: requestSummary(item, applied) }
        })
      }
      proposal.status =
        applied.length === 0
          ? 'rejected'
          : applied.length === proposal.steps.length
            ? 'applied'
            : 'partially-applied'
      await deps.conversations
        .append(proposal.packId, proposal.agent, [
          {
            id: newId(),
            at: now().toISOString(),
            role: 'tool',
            text: decisionNote(proposal, applied),
            proposalId
          }
        ])
        .catch(() => undefined)
      return {
        png: replay.png,
        appliedStepIds: applied.map((s) => s.id),
        briefUpdated: patches.length > 0
      }
    },

    async rejectProposal(proposalId) {
      const { proposal } = proposals.getPending(proposalId)
      proposal.status = 'rejected'
      await deps.conversations
        .append(proposal.packId, proposal.agent, [
          {
            id: newId(),
            at: now().toISOString(),
            role: 'tool',
            text: decisionNote(proposal, []),
            proposalId
          }
        ])
        .catch(() => undefined)
    },

    async idle() {
      while (active.size > 0) await Promise.all([...active.values()].map((r) => r.done))
    }
  }
}
