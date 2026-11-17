import { randomUUID } from 'node:crypto'
import { decodePng, type RgbaImage } from '@shared/image'
import type { PreviewModel } from '@shared/model/preview'
import { describeModelLayout } from '@shared/preview/layout'
import {
  isBulkProposal,
  isCreationProposal,
  type AgentEvent,
  type AgentKind,
  type AgentSettings,
  type BulkProposal,
  type BulkProposalApplyResult,
  type ConversationTurn,
  type CreationAgentRequest,
  type CreationApplyResult,
  type CreationProposal,
  type DataExplainRequest,
  type PackMetaPatch,
  type ProposalStep,
  type EditorAgentRequest,
  type NavigationAgentRequest,
  type Proposal,
  type ProposalApplyResult
} from '@shared/ai/types'
import { frameHeightOf } from '@shared/bulk/operations'
import { encodePng } from '@shared/image'
import type { BulkItem } from '@shared/model/bulk'
import type { TextureEntry } from '@shared/model/pack'
import type { DataList } from '@shared/model/data'
import type { HistoryEntry } from '@shared/model/history'
import type { BulkOperation } from '@shared/bulk/operations'
import type { JobReporter, ProviderRegistry } from '../../contracts'
import { AppErrorException } from '../../../ipc/registry'
import type { BriefService } from '../../brief'
import type { ConversationStore } from './conversation'
import { ProposalStore, decisionNote, replayProposal, requestSummary } from './proposals'
import { errorOf, frameLayoutOf, runEditorAgent } from './runtime'
import { replayTargets, runNavigationAgent, type NavigationTexture } from './navigation'
import type { BulkService } from '../../bulk'
import { pickSamples, runCreationAgent, type CreationSample } from './creation'
import { buildExplainMessages, gatherExplainSources, type ExplainDeps } from './explain'
import { runAgentLoop } from './loop'

/** Largest selection the navigation agent works on. */
export const MAX_NAVIGATION_TEXTURES = 2000

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
  /** 3D preview model of a pack texture (same as 'texture.preview'), described to the agent. */
  previewModel?: (packId: string, path: string) => Promise<PreviewModel | null>
  /** Navigation agent: the pack's textures, their current PNG, and the bulk service that writes results. */
  navigation?: {
    textures(packId: string): Promise<TextureEntry[]>
    readPng(packId: string, path: string): Promise<Uint8Array | null>
    bulk: Pick<BulkService, 'compute' | 'write'>
  }
  /** Creation agent (uses `navigation` for textures and writes): pack name / description, plan progress. */
  creation?: {
    /** Textures the agent can change: the pack's plus vanilla, whatever the base (see PackService.catalog). */
    catalog(packId: string): Promise<TextureEntry[]>
    /** PNG of a catalog texture: the pack's file, else vanilla. */
    readPng(packId: string, path: string): Promise<Uint8Array | null>
    meta(packId: string): Promise<{
      name: string
      description: string
      base: 'vanilla' | 'empty'
      kind?: 'resource' | 'data' | 'combined'
    }>
    setMeta(packId: string, patch: PackMetaPatch): Promise<void>
    /** Data packs and combined packs (M10): the data files the agent reads, and the writer of accepted files. */
    data?: {
      list(packId: string): Promise<DataList>
      read(packId: string, path: string): Promise<string | null>
      saveMany(
        packId: string,
        files: ReadonlyArray<{ path: string; text: string }>,
        change: { source: HistoryEntry['source']; label: HistoryEntry['label'] }
      ): Promise<unknown>
    }
    jobs?: JobReporter
  }
  /** "Explain" in the data editor (M10): what the explanation reads about the file and the game. */
  explain?: ExplainDeps
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
  /** Starts a navigation-agent run on a selection (stopping the pack's previous navigation run). */
  sendNavigation(request: NavigationAgentRequest): Promise<{ runId: string }>
  runNavigation(
    request: NavigationAgentRequest,
    emit: (event: AgentEvent) => void,
    signal: AbortSignal,
    runId?: string
  ): Promise<void>
  /** Replays the accepted steps on the accepted textures and writes them as one history entry. */
  applyNavigation(
    proposalId: string,
    acceptedStepIds: string[],
    acceptedPaths: string[]
  ): Promise<BulkProposalApplyResult>
  /** Starts a creation-agent run on the whole pack (stopping the pack's previous creation run). */
  sendCreation(request: CreationAgentRequest): Promise<{ runId: string }>
  runCreation(
    request: CreationAgentRequest,
    emit: (event: AgentEvent) => void,
    signal: AbortSignal,
    runId?: string
  ): Promise<void>
  /**
   * Applies the accepted steps of a creation plan: brief and pack meta changes first, then each texture step on every
   * matched texture (current pixels), one history entry per step ('ai.plan.apply' progress). Stops between steps
   * after stopCreationApply.
   */
  applyCreation(proposalId: string, acceptedStepIds: string[]): Promise<CreationApplyResult>
  /** Asks a running applyCreation to stop after the current step. */
  stopCreationApply(proposalId: string): void
  rejectProposal(proposalId: string): Promise<void>
  /**
   * Starts an explanation of a data file (one answer, no tools, nothing proposed), streamed as 'ai.event' like the
   * agents. Stops the pack's previous explanation.
   */
  sendExplain(request: DataExplainRequest): Promise<{ runId: string }>
  runExplain(
    request: DataExplainRequest,
    emit: (event: AgentEvent) => void,
    signal: AbortSignal,
    runId?: string
  ): Promise<void>
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

  /** Body part / block face layout of the texture, or undefined (never fails the run). */
  async function modelLayout(
    packId: string,
    path: string,
    img: RgbaImage
  ): Promise<string | undefined> {
    if (!deps.previewModel) return undefined
    try {
      return describeModelLayout(await deps.previewModel(packId, path), path, img.width, img.height)
    } catch {
      return undefined
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
      const [brief, vanilla, history, layout] = await Promise.all([
        deps.brief.get(packId),
        readVanilla(packId, request.texture.path),
        deps.conversations.read(packId, 'editor'),
        modelLayout(packId, request.texture.path, base)
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
          history,
          ...(layout ? { modelLayout: layout } : {})
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
          ...(request.texture.animation && frameLayoutOf(request, base)
            ? { animation: request.texture.animation }
            : {}),
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

  /** Runs `job` in the background as the pack + agent's only run (the previous one is stopped first). */
  function start(
    key: string,
    job: (runId: string, signal: AbortSignal) => Promise<void>
  ): { runId: string } {
    const previous = active.get(key)
    previous?.controller.abort()
    const runId = newId()
    const controller = new AbortController()
    const entry: ActiveRun = {
      runId,
      controller,
      done: (async (): Promise<void> => {
        await previous?.done
        await job(runId, controller.signal)
      })().finally(() => {
        if (active.get(key) === entry) active.delete(key)
        byRunId.delete(runId)
      })
    }
    active.set(key, entry)
    byRunId.set(runId, entry)
    return { runId }
  }

  /** Creation plans being applied, with their stop flag. */
  const applying = new Map<string, { stop: boolean }>()

  function creationDeps(): NonNullable<EditorAgentServiceDeps['creation']> {
    if (!deps.creation || !deps.navigation) throw new AppErrorException('ai.agentFailed')
    return deps.creation
  }

  /** Representative textures of the pack, decoded (unreadable ones are skipped). */
  async function loadSamples(packId: string, entries: TextureEntry[]): Promise<CreationSample[]> {
    const creation = creationDeps()
    const samples: CreationSample[] = []
    for (const entry of pickSamples(entries)) {
      const png = await creation.readPng(packId, entry.path)
      if (!png) continue
      try {
        const image = decodePng(png)
        const frameHeight = frameHeightOf(entry)
        samples.push({ path: entry.path, image, ...(frameHeight ? { frameHeight } : {}) })
      } catch {
        // skipped
      }
    }
    return samples
  }

  async function runCreation(
    request: CreationAgentRequest,
    emit: (event: AgentEvent) => void,
    signal: AbortSignal,
    runId = newId()
  ): Promise<void> {
    const { packId } = request
    emit({ runId, type: 'started', agent: 'creation', model: request.model })
    let result: Awaited<ReturnType<typeof runCreationAgent>>
    let proposal: CreationProposal | undefined
    try {
      proposals.expireFor(packId, 'creation')
      const creation = creationDeps()
      const pack = await creation.meta(packId)
      const kind = pack.kind ?? 'resource'
      // A data pack has no textures to work on (and may not have vanilla textures extracted at all).
      const textures = kind === 'data' ? [] : await creation.catalog(packId)
      if (textures.length === 0 && kind !== 'data') throw new AppErrorException('ai.emptyPack')
      const dataDeps = kind !== 'resource' ? creation.data : undefined
      const [samples, brief, history, dataList] = await Promise.all([
        loadSamples(packId, textures),
        deps.brief.get(packId),
        deps.conversations.read(packId, 'creation'),
        dataDeps ? dataDeps.list(packId) : Promise.resolve(undefined)
      ])
      const data =
        dataDeps && dataList
          ? {
              entries: dataList.entries,
              ids: dataList.ids,
              read: (path: string) => dataDeps.read(packId, path)
            }
          : undefined
      await deps.conversations.append(packId, 'creation', [
        {
          id: newId(),
          at: now().toISOString(),
          role: 'user',
          text: request.message,
          model: request.model
        }
      ])
      result = await runCreationAgent(
        {
          runId,
          request,
          textures,
          samples,
          pack,
          ...(data ? { data } : {}),
          settings: deps.getAgentSettings('creation'),
          brief,
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
          agent: 'creation',
          kind: 'plan',
          packId,
          steps: result.steps,
          status: 'pending'
        }
        proposals.add(proposal, request.message)
        const last = [...result.turns].reverse().find((t) => t.role === 'assistant')
        if (last) last.proposalId = proposal.id
      }
      await deps.conversations.append(packId, 'creation', result.turns).catch(() => undefined)
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

  async function runExplain(
    request: DataExplainRequest,
    emit: (event: AgentEvent) => void,
    signal: AbortSignal,
    runId = newId()
  ): Promise<void> {
    emit({ runId, type: 'started', agent: 'explain', model: request.model })
    let result: Awaited<ReturnType<typeof runAgentLoop>>
    try {
      if (!deps.explain) throw new AppErrorException('ai.agentFailed')
      const sources = await gatherExplainSources(request, deps.explain)
      const modelInfo = await deps.providers.getModel(request.model).catch(() => undefined)
      result = await runAgentLoop(
        {
          agent: 'explain',
          tools: [],
          messages: buildExplainMessages(sources, request.language),
          execute: () => ({ ok: false, kind: 'read', summary: '', content: '{}' }),
          kindOf: () => 'read'
        },
        {
          runId,
          model: request.model,
          ...(modelInfo ? { modelInfo } : {}),
          thinking: request.thinking ?? 'off',
          maxIterations: 1
        },
        { providers: deps.providers, newId, now, tokenBudget: deps.tokenBudget },
        emit,
        signal
      )
    } catch (err) {
      emit({ runId, type: 'done', reason: 'error', error: errorOf(err) })
      return
    }
    // One answer: a model that asks for tools anyway still ends here ('budget' would read as an error).
    emit({
      runId,
      type: 'done',
      reason: result.reason === 'budget' ? 'end' : result.reason,
      ...(result.error ? { error: result.error } : {})
    })
  }

  async function applyCreation(
    proposalId: string,
    acceptedStepIds: string[]
  ): Promise<CreationApplyResult> {
    const item = proposals.getPending(proposalId)
    const { proposal } = item
    if (!isCreationProposal(proposal)) {
      throw new AppErrorException('ai.proposalNotPending', { proposalId, status: 'wrong-kind' })
    }
    if (applying.has(proposalId)) {
      throw new AppErrorException('ai.proposalNotPending', { proposalId, status: 'applying' })
    }
    const nav = navigationDeps()
    const creation = creationDeps()
    const flag = { stop: false }
    applying.set(proposalId, flag)
    try {
      const ids = new Set(acceptedStepIds)
      const accepted = proposal.steps.filter((s) => ids.has(s.id))
      const memory = accepted.filter((s) => s.kind === 'memory')
      const jsonSteps = accepted.filter((s) => s.json)
      const textureSteps = accepted.filter((s) => s.kind === 'mutate' && !s.json)
      const patches = memory.flatMap((s) => (s.briefPatch ? [s.briefPatch] : []))
      const meta: PackMetaPatch = Object.assign({}, ...memory.map((s) => s.packMeta ?? {}))
      if (meta.name !== undefined || meta.description !== undefined) {
        await creation.setMeta(proposal.packId, meta)
      }

      // Data files: all accepted ones in one history entry, before the (long) texture steps.
      let filesWritten = 0
      if (jsonSteps.length > 0) {
        if (!creation.data) throw new AppErrorException('ai.agentFailed')
        await creation.data.saveMany(
          proposal.packId,
          jsonSteps.map((s) => ({ path: s.json!.path, text: s.json!.text })),
          { source: 'ai', label: { key: 'aiDataFiles', params: { count: jsonSteps.length } } }
        )
        filesWritten = jsonSteps.length
      }

      const progress = creation.jobs?.start('ai.plan.apply')
      const applied: ProposalStep[] = [...memory, ...jsonSteps]
      let written = 0
      let checkpoints = 0
      let stopped = false
      const catalog = textureSteps.length ? await creation.catalog(proposal.packId) : []
      for (const [i, step] of textureSteps.entries()) {
        if (flag.stop) {
          stopped = true
          break
        }
        progress?.('step', i, textureSteps.length)
        const op = { tool: step.tool, args: step.args } as BulkOperation
        // Current pixels: the pack's file, or vanilla for textures the pack does not have yet (empty pack).
        const before = new Map<string, Uint8Array>()
        for (const path of step.targets ?? []) {
          const png = await creation.readPng(proposal.packId, path)
          if (png) before.set(path, png)
        }
        const computed = await nav.bulk.compute(
          proposal.packId,
          (step.targets ?? []).map((path) => ({ path, ops: [op] })),
          { kind: 'bulk.apply', before, entries: catalog }
        )
        if (computed.items.length > 0) {
          written += await nav.bulk.write(
            proposal.packId,
            computed.items.map((x) => ({ path: x.path, png: x.afterPng })),
            {
              source: 'ai',
              label: {
                key: 'aiPlanStep',
                params: { step: i + 1, total: textureSteps.length, count: computed.items.length }
              }
            }
          )
          checkpoints++
        }
        applied.push(step)
      }
      progress?.('step', applied.length - memory.length - jsonSteps.length, textureSteps.length)

      if (applied.length > 0) {
        const decided = patches.some((p) => p.addDecision?.trim())
        const fields = [...new Set(patches.flatMap((p) => Object.keys(p)))].join(', ')
        await deps.brief.change(proposal.packId, {
          patches,
          by: 'creation',
          ...(patches.length && !decided
            ? { decision: `Style brief change accepted by the user (${fields})` }
            : {}),
          requestLog: { agent: 'creation', summary: requestSummary(item, applied, written) }
        })
      }
      proposal.status =
        applied.length === 0
          ? 'rejected'
          : applied.length === proposal.steps.length
            ? 'applied'
            : 'partially-applied'
      const note =
        decisionNote(proposal, applied, written) +
        (stopped ? ' The user stopped the plan before the remaining steps.' : '')
      await deps.conversations
        .append(proposal.packId, 'creation', [
          { id: newId(), at: now().toISOString(), role: 'tool', text: note, proposalId }
        ])
        .catch(() => undefined)
      return {
        // In plan order (brief and meta steps were applied first).
        appliedStepIds: proposal.steps.filter((s) => applied.includes(s)).map((s) => s.id),
        texturesWritten: written,
        checkpoints,
        stopped,
        briefUpdated: patches.length > 0,
        metaUpdated: meta.name !== undefined || meta.description !== undefined,
        filesWritten
      }
    } finally {
      applying.delete(proposalId)
    }
  }

  function navigationDeps(): NonNullable<EditorAgentServiceDeps['navigation']> {
    if (!deps.navigation) throw new AppErrorException('ai.agentFailed')
    return deps.navigation
  }

  /** The selection, decoded, in request order (unknown paths and unreadable files are skipped). */
  async function loadSelection(
    packId: string,
    paths: string[]
  ): Promise<{ textures: NavigationTexture[]; bases: Map<string, Uint8Array> }> {
    const nav = navigationDeps()
    const entries = new Map((await nav.textures(packId)).map((e) => [e.path, e]))
    const textures: NavigationTexture[] = []
    const bases = new Map<string, Uint8Array>()
    for (const path of [...new Set(paths)].slice(0, MAX_NAVIGATION_TEXTURES)) {
      const entry = entries.get(path)
      if (!entry) continue
      const png = await nav.readPng(packId, path)
      if (!png) continue
      let image
      try {
        image = decodePng(png)
      } catch {
        continue
      }
      const frameHeight = frameHeightOf(entry)
      textures.push({ path, image, ...(frameHeight ? { frameHeight } : {}) })
      bases.set(path, png)
    }
    if (textures.length === 0) throw new AppErrorException('ai.emptySelection')
    return { textures, bases }
  }

  async function runNavigation(
    request: NavigationAgentRequest,
    emit: (event: AgentEvent) => void,
    signal: AbortSignal,
    runId = newId()
  ): Promise<void> {
    const { packId } = request
    emit({ runId, type: 'started', agent: 'navigation', model: request.model })
    let result: Awaited<ReturnType<typeof runNavigationAgent>>
    let proposal: BulkProposal | undefined
    try {
      proposals.expireFor(packId, 'navigation')
      const [selection, brief, history] = await Promise.all([
        loadSelection(packId, request.paths),
        deps.brief.get(packId),
        deps.conversations.read(packId, 'navigation')
      ])
      await deps.conversations.append(packId, 'navigation', [
        {
          id: newId(),
          at: now().toISOString(),
          role: 'user',
          text: request.message,
          model: request.model
        }
      ])
      result = await runNavigationAgent(
        {
          runId,
          request,
          textures: selection.textures,
          settings: deps.getAgentSettings('navigation'),
          brief,
          history
        },
        { providers: deps.providers, newId, now, tokenBudget: deps.tokenBudget },
        emit,
        signal
      )
      if (result.steps.length > 0) {
        const items: BulkItem[] = [...result.changed].map(([path, image]) => ({
          path,
          name: path.slice(path.lastIndexOf('/') + 1).replace(/\.png$/, ''),
          beforePng: selection.bases.get(path)!,
          afterPng: encodePng(image),
          changedPixels: 0
        }))
        proposal = {
          id: newId(),
          runId,
          agent: 'navigation',
          kind: 'bulk',
          packId,
          steps: result.steps,
          items,
          status: 'pending'
        }
        proposals.add(proposal, request.message, selection.bases)
        const last = [...result.turns].reverse().find((t) => t.role === 'assistant')
        if (last) last.proposalId = proposal.id
      }
      await deps.conversations.append(packId, 'navigation', result.turns).catch(() => undefined)
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

  return {
    async send(request) {
      // Fail fast on what the renderer can fix; everything else is reported through 'ai.event'.
      decode(request.texture.png)
      if (!(await deps.packs.locate(request.packId))) {
        throw new AppErrorException('packs.notFound', { packId: request.packId })
      }
      return start(`${request.packId}:editor`, (runId, signal) =>
        run(request, deps.emit, signal, runId)
      )
    },

    async sendNavigation(request) {
      navigationDeps()
      if (!(await deps.packs.locate(request.packId))) {
        throw new AppErrorException('packs.notFound', { packId: request.packId })
      }
      return start(`${request.packId}:navigation`, (runId, signal) =>
        runNavigation(request, deps.emit, signal, runId)
      )
    },

    runNavigation,

    async sendCreation(request) {
      creationDeps()
      if (!(await deps.packs.locate(request.packId))) {
        throw new AppErrorException('packs.notFound', { packId: request.packId })
      }
      return start(`${request.packId}:creation`, (runId, signal) =>
        runCreation(request, deps.emit, signal, runId)
      )
    },

    runCreation,
    applyCreation,

    stopCreationApply(proposalId) {
      const flag = applying.get(proposalId)
      if (flag) flag.stop = true
    },

    async applyNavigation(proposalId, acceptedStepIds, acceptedPaths) {
      const item = proposals.getPending(proposalId)
      const { proposal } = item
      if (!isBulkProposal(proposal) || !item.bases) {
        throw new AppErrorException('ai.proposalNotPending', { proposalId, status: 'wrong-kind' })
      }
      const nav = navigationDeps()
      const stepIds = new Set(acceptedStepIds)
      const applied = proposal.steps.filter((s) => stepIds.has(s.id))
      const patches = applied.flatMap((s) =>
        s.kind === 'memory' && s.briefPatch ? [s.briefPatch] : []
      )
      // Replay on the pixels the agent saw, then write the ticked textures as one entry.
      const targets = replayTargets(proposal.steps, stepIds, new Set(acceptedPaths))
      const computed = await nav.bulk.compute(proposal.packId, targets, {
        before: item.bases,
        kind: 'bulk.apply'
      })
      const written = await nav.bulk.write(
        proposal.packId,
        computed.items.map((i) => ({ path: i.path, png: i.afterPng })),
        { source: 'ai', label: { key: 'aiBulk', params: { count: computed.items.length } } }
      )
      if (applied.length > 0) {
        const decided = patches.some((p) => p.addDecision?.trim())
        const fields = [...new Set(patches.flatMap((p) => Object.keys(p)))].join(', ')
        await deps.brief.change(proposal.packId, {
          patches,
          by: proposal.agent,
          ...(patches.length && !decided
            ? { decision: `Style brief change accepted by the user (${fields})` }
            : {}),
          requestLog: { agent: proposal.agent, summary: requestSummary(item, applied, written) }
        })
      }
      proposal.status =
        applied.length === 0
          ? 'rejected'
          : applied.length === proposal.steps.length &&
              acceptedPaths.length >= proposal.items.length
            ? 'applied'
            : 'partially-applied'
      await deps.conversations
        .append(proposal.packId, proposal.agent, [
          {
            id: newId(),
            at: now().toISOString(),
            role: 'tool',
            text: decisionNote(proposal, applied, written),
            proposalId
          }
        ])
        .catch(() => undefined)
      return {
        applied: written,
        appliedStepIds: applied.map((s) => s.id),
        briefUpdated: patches.length > 0
      }
    },

    run,

    async sendExplain(request) {
      if (!deps.explain) throw new AppErrorException('ai.agentFailed')
      if (!(await deps.packs.locate(request.packId))) {
        throw new AppErrorException('packs.notFound', { packId: request.packId })
      }
      return start(`${request.packId}:explain`, (runId, signal) =>
        runExplain(request, deps.emit, signal, runId)
      )
    },

    runExplain,

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
      if (isBulkProposal(proposal) || isCreationProposal(proposal)) {
        throw new AppErrorException('ai.proposalNotPending', { proposalId, status: 'wrong-kind' })
      }
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
