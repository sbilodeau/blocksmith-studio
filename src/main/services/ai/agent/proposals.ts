import { decodePng, encodePng, type RgbaImage } from '@shared/image'
import {
  executeOnFrames,
  frameCount,
  getTool,
  isFrameTool,
  parseFrame,
  takeFrame
} from '@shared/ai/tools'
import {
  isBulkProposal,
  isCreationProposal,
  type AgentKind,
  type AnyProposal,
  type Proposal,
  type ProposalStep
} from '@shared/ai/types'
import type { StyleBrief, StyleBriefPatch } from '@shared/model/brief'
import { AppErrorException } from '../../../ipc/registry'

/** Pending proposals expire after this long. */
export const PROPOSAL_TTL_MS = 60 * 60 * 1000

export interface StoredProposal<P extends AnyProposal = AnyProposal> {
  proposal: P
  createdAt: number
  /** The user message that produced it (for the request log). */
  request: string
  /** Bulk proposals: the PNG of every selected texture as the agent saw it (replayed on apply). */
  bases?: ReadonlyMap<string, Uint8Array>
}

/**
 * Proposals kept in memory by id. Pending ones expire after `ttlMs`, or when a new run starts for the same pack
 * and agent; decided ones (applied / rejected) are kept until expiry so a second decision gets a clear error.
 */
export class ProposalStore {
  private readonly items = new Map<string, StoredProposal>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = PROPOSAL_TTL_MS
  ) {}

  add(proposal: AnyProposal, request: string, bases?: ReadonlyMap<string, Uint8Array>): void {
    this.prune()
    this.items.set(proposal.id, {
      proposal,
      createdAt: this.now(),
      request,
      ...(bases ? { bases } : {})
    })
  }

  /** Throws ai.proposalNotFound (unknown or expired). */
  get(id: string): StoredProposal {
    this.prune()
    const item = this.items.get(id)
    if (!item) throw new AppErrorException('ai.proposalNotFound', { proposalId: id })
    return item
  }

  /** Throws ai.proposalNotFound / ai.proposalNotPending. */
  getPending(id: string): StoredProposal {
    const item = this.get(id)
    if (item.proposal.status !== 'pending') {
      throw new AppErrorException('ai.proposalNotPending', {
        proposalId: id,
        status: item.proposal.status
      })
    }
    return item
  }

  /** Drops the pending proposals of a pack + agent (a new run replaces them). */
  expireFor(packId: string, agent: AgentKind): void {
    for (const [id, item] of this.items) {
      const p = item.proposal
      if (p.packId === packId && p.agent === agent && p.status === 'pending') this.items.delete(id)
    }
  }

  private prune(): void {
    const limit = this.now() - this.ttlMs
    for (const [id, item] of this.items) if (item.createdAt < limit) this.items.delete(id)
  }
}

export interface ReplayResult {
  image: RgbaImage
  png: Uint8Array
  applied: ProposalStep[]
  patches: StyleBriefPatch[]
}

/**
 * Replays ONLY the accepted steps, in proposal order, on the base image by re-executing the tools (deterministic).
 * Accepted steps run even when a step they depend on was unchecked (the plan UI warns about it). Memory steps
 * contribute their brief patch. Throws ai.replayFailed when a tool fails.
 */
export function replayProposal(
  proposal: Proposal,
  acceptedStepIds: readonly string[],
  brief: StyleBrief
): ReplayResult {
  const accepted = new Set(acceptedStepIds)
  let image = decodePng(proposal.basePng)
  const applied: ProposalStep[] = []
  const patches: StyleBriefPatch[] = []
  for (const step of proposal.steps) {
    if (!accepted.has(step.id)) continue
    if (step.kind === 'memory') {
      if (step.briefPatch) patches.push(step.briefPatch)
      applied.push(step)
      continue
    }
    const tool = getTool(step.tool)
    if (!tool || tool.kind !== 'mutate') {
      throw new AppErrorException('ai.replayFailed', { step: step.id, tool: step.tool })
    }
    try {
      const ctx = { image, vanilla: null, brief }
      const anim = proposal.animation
      let out
      if (anim && image.height % anim.frameHeight === 0 && isFrameTool(tool)) {
        // Same frame as during the run: the one in the arguments, else every frame.
        const { frame, rest } = takeFrame(step.args)
        const layout = { frameHeight: anim.frameHeight, current: anim.frame }
        const n = frameCount(image, layout)
        out = executeOnFrames(tool, ctx, tool.params.parse(rest), layout, parseFrame(frame, n))
      } else {
        out = tool.execute(ctx, tool.params.parse(step.args))
      }
      if (out.image) image = out.image
    } catch {
      throw new AppErrorException('ai.replayFailed', { step: step.id, tool: step.tool })
    }
    applied.push(step)
  }
  return { image, png: encodePng(image), applied, patches }
}

/** "block/stone.png" from "assets/minecraft/textures/block/stone.png" (other namespaces keep "ns:"). */
export function shortTexturePath(path: string): string {
  const m = /^assets\/([^/]+)\/textures\/(.+)$/.exec(path)
  if (!m) return path
  return m[1] === 'minecraft' ? m[2] : `${m[1]}:${m[2]}`
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 3)}...`
}

/** One line for the brief's requestLog (app-generated). */
export function requestSummary(
  item: StoredProposal,
  applied: ProposalStep[],
  textureCount?: number
): string {
  const { proposal } = item
  const tools = [...new Set(applied.map((s) => s.tool))].join(', ')
  const where = isBulkProposal(proposal)
    ? `${textureCount ?? proposal.items.length} selected textures`
    : isCreationProposal(proposal)
      ? `whole pack (${textureCount ?? 0} texture writes)`
      : shortTexturePath(proposal.texturePath)
  return clip(
    `${where}: "${clip(item.request, 100)}" -> ${tools} (${applied.length} of ${proposal.steps.length} steps)`,
    300
  )
}

/** Conversation note so the agent knows what the user did with its plan. */
export function decisionNote(
  proposal: AnyProposal,
  applied: ProposalStep[],
  textureCount?: number
): string {
  const total = proposal.steps.length
  if (applied.length === 0) return `The user rejected the proposal (applied 0 of ${total} steps).`
  const skipped = proposal.steps.filter((s) => !applied.includes(s)).map((s) => s.tool)
  return `The user applied ${applied.length} of ${total} steps (${applied.map((s) => s.tool).join(', ')})${
    skipped.length ? `; not applied: ${skipped.join(', ')}` : ''
  }. ${
    isBulkProposal(proposal)
      ? `${textureCount ?? 0} of ${proposal.items.length} changed textures were written; they now reflect only the applied steps.`
      : isCreationProposal(proposal)
        ? `${textureCount ?? 0} texture writes, one history entry per applied step.`
        : 'The texture now reflects only the applied steps.'
  }`
}
