import { z } from 'zod'
import type { InvokeChannel, EventChannel } from './channels'
import { SettingsPatchSchema, type Settings } from '../model/settings'
import type { UpdaterStatus } from '../model/updater'
import type { MinecraftInstall, VanillaAvailability } from '../model/vanilla'
import {
  CreatePackInputSchema,
  ExportPackTypeSchema,
  type CategorySummary,
  type ExportReport,
  type ImportReport,
  type UpgradeReport,
  type DoctorReport,
  type PackSummary,
  type TextureEntry
} from '../model/pack'
import type { JobProgress } from '../model/jobs'
import {
  BulkApplyInputSchema,
  BulkPreviewInputSchema,
  MAX_BULK_TEXTURES,
  type BulkApplyResult,
  type BulkPreview
} from '../model/bulk'
import type { HistoryState, TextureData } from '../model/history'
import type { PreviewModel } from '../model/preview'
import {
  ProviderConfigSchema,
  ModelRefSchema,
  LanguageSchema,
  ReasoningLevelSchema
} from '../model/settings'
import { StyleBriefPatchSchema, type StyleBrief } from '../model/brief'
import type {
  AgentEvent,
  ConversationTurn,
  EvalProgress,
  EvalReport,
  ModelInfo,
  BulkProposalApplyResult,
  CreationApplyResult,
  ProposalApplyResult,
  ProviderStatus
} from '../ai/types'
import {
  MergeApplyInputSchema,
  MergePreviewInputSchema,
  type MergePlan,
  type MergeResult
} from '../model/merge'

/** Typed, i18n-keyed error returned across IPC (message key: `errors.<code>`). */
export interface AppError {
  code: string
  params?: Record<string, string | number>
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform | string
  arch: string
  electron: string
  chrome: string
  node: string
  isPackaged: boolean
}

const NoInput = z.undefined()
const PackRef = z.object({ packId: z.string().min(1).max(64) }).strict()
/** POSIX pack-relative path of a texture: assets/<namespace>/textures/...png (validated again in main). */
const TexturePathSchema = z
  .string()
  .max(512)
  .regex(/^assets\/[a-z0-9_.-]+\/textures\/[a-z0-9_./-]+\.png$/)
  .refine((p) => !p.split('/').some((s) => s === '..' || s === '.' || s === ''))
const TextureRef = PackRef.extend({ path: TexturePathSchema }).strict()
const MAX_PNG_BYTES = 16 * 1024 * 1024
const VersionId = z.string().regex(/^[0-9][0-9a-z.-]{0,31}$/)

/** Runtime input validation for every invoke channel. Main validates each payload against this. */
export const inputSchemas = {
  'app.getInfo': NoInput,
  'app.openExternal': z.object({ url: z.url({ protocol: /^https$/ }) }).strict(),
  'settings.get': NoInput,
  'settings.update': SettingsPatchSchema,
  'updater.getStatus': NoInput,
  'updater.check': NoInput,
  'updater.download': NoInput,
  'updater.install': NoInput,
  'minecraft.detect': NoInput,
  'minecraft.addPath': NoInput,
  'vanilla.availability': NoInput,
  'vanilla.prepare': z.object({ versionId: VersionId }).strict(),
  'workspace.get': NoInput,
  'workspace.choose': NoInput,
  'packs.list': NoInput,
  'packs.create': CreatePackInputSchema,
  'packs.import': NoInput,
  'packs.delete': PackRef,
  'packs.reveal': PackRef,
  'pack.get': PackRef,
  'pack.textures': PackRef,
  'pack.categories': PackRef,
  'pack.export': PackRef.extend({
    targetVersion: VersionId,
    /** Also declare newer formats (snapshots, future releases) as supported in pack.mcmeta. */
    acceptNewer: z.boolean().optional(),
    /** Resource pack (default) or data pack. */
    packType: ExportPackTypeSchema.optional()
  }).strict(),
  'pack.exportMany': PackRef.extend({
    /** One zip per version, in a folder the user picks. */
    targetVersions: z.array(VersionId).min(1).max(40),
    /** Also declare newer formats (snapshots, future releases) as supported in pack.mcmeta. */
    acceptNewer: z.boolean().optional(),
    /** Resource pack (default) or data pack. */
    packType: ExportPackTypeSchema.optional()
  }).strict(),
  'pack.upgrade': PackRef.extend({ targetVersion: VersionId }).strict(),
  'pack.doctor': PackRef,
  'texture.read': TextureRef,
  'texture.save': TextureRef.extend({
    png: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= MAX_PNG_BYTES)
  }).strict(),
  'texture.revert': TextureRef,
  'history.get': PackRef,
  'history.undo': PackRef,
  'history.redo': PackRef,
  'texture.preview': TextureRef,
  'ai.providers.list': NoInput,
  'ai.providers.save': ProviderConfigSchema,
  'ai.providers.delete': z.object({ providerId: z.string().min(1).max(40) }).strict(),
  'ai.providers.setKey': z
    .object({ providerId: z.string().min(1).max(40), key: z.string().max(4096) })
    .strict(),
  'ai.providers.test': z.object({ providerId: z.string().min(1).max(40) }).strict(),
  'ai.models.list': z
    .object({ providerId: z.string().min(1).max(40).optional(), refresh: z.boolean().optional() })
    .strict()
    .optional(),
  'ai.agent.send': z
    .object({
      packId: z.string().min(1).max(64),
      message: z.string().trim().min(1).max(4000),
      model: ModelRefSchema,
      texture: z
        .object({
          path: TexturePathSchema,
          png: z
            .instanceof(Uint8Array)
            .refine((b) => b.byteLength > 0 && b.byteLength <= MAX_PNG_BYTES)
        })
        .strict(),
      language: LanguageSchema,
      thinking: ReasoningLevelSchema.optional()
    })
    .strict(),
  'ai.agent.stop': z.object({ runId: z.string().min(1).max(64) }).strict(),
  'ai.agent.conversation': PackRef.extend({
    agent: z.enum(['creation', 'navigation', 'editor'])
  }).strict(),
  'ai.agent.clear': PackRef.extend({
    agent: z.enum(['creation', 'navigation', 'editor'])
  }).strict(),
  'ai.proposal.apply': z
    .object({
      proposalId: z.string().min(1).max(64),
      acceptedStepIds: z.array(z.string().max(64)).max(200)
    })
    .strict(),
  'ai.proposal.reject': z.object({ proposalId: z.string().min(1).max(64) }).strict(),
  'ai.navigation.send': z
    .object({
      packId: z.string().min(1).max(64),
      message: z.string().trim().min(1).max(4000),
      model: ModelRefSchema,
      /** The grid selection the agent works on. */
      paths: z.array(TexturePathSchema).min(1).max(MAX_BULK_TEXTURES),
      language: LanguageSchema,
      thinking: ReasoningLevelSchema.optional()
    })
    .strict(),
  'ai.navigation.apply': z
    .object({
      proposalId: z.string().min(1).max(64),
      acceptedStepIds: z.array(z.string().max(64)).max(200),
      acceptedPaths: z.array(TexturePathSchema).max(MAX_BULK_TEXTURES)
    })
    .strict(),
  'ai.creation.send': z
    .object({
      packId: z.string().min(1).max(64),
      message: z.string().trim().min(1).max(4000),
      model: ModelRefSchema,
      language: LanguageSchema,
      thinking: ReasoningLevelSchema.optional()
    })
    .strict(),
  'ai.creation.apply': z
    .object({
      proposalId: z.string().min(1).max(64),
      acceptedStepIds: z.array(z.string().max(64)).max(200)
    })
    .strict(),
  'ai.creation.stopApply': z.object({ proposalId: z.string().min(1).max(64) }).strict(),
  'bulk.preview': BulkPreviewInputSchema,
  'bulk.apply': BulkApplyInputSchema,
  'bulk.discard': z.object({ previewId: z.string().min(1).max(64) }).strict(),
  'merge.preview': MergePreviewInputSchema,
  'merge.apply': MergeApplyInputSchema,
  'merge.discard': z.object({ planId: z.string().min(1).max(64) }).strict(),
  'brief.get': PackRef,
  'brief.update': PackRef.extend({ patch: StyleBriefPatchSchema }).strict(),
  'ai.eval.run': z.object({ model: ModelRefSchema, quick: z.boolean().default(true) }).strict(),
  'ai.eval.stop': NoInput
} satisfies Record<InvokeChannel, z.ZodType>

/** Output types (compile-time only; main is trusted). */
export interface InvokeOutputs {
  'app.getInfo': AppInfo
  'app.openExternal': void
  'settings.get': Settings
  'settings.update': Settings
  'updater.getStatus': UpdaterStatus
  'updater.check': UpdaterStatus
  'updater.download': UpdaterStatus
  'updater.install': void
  /** Auto-detected launchers plus folders/jars added by hand. */
  'minecraft.detect': MinecraftInstall[]
  /** Opens a folder/jar picker; null when cancelled. */
  'minecraft.addPath': MinecraftInstall | null
  /** One entry per supported version (support window), newest first. */
  'vanilla.availability': VanillaAvailability[]
  /** Extracts (and downloads from Mojang if allowed in settings) the vanilla assets. Emits job.progress. */
  'vanilla.prepare': VanillaAvailability
  'workspace.get': { path: string }
  /** Opens a folder picker; null when cancelled. */
  'workspace.choose': { path: string } | null
  'packs.list': PackSummary[]
  'packs.create': PackSummary
  /** Opens a .zip picker; null when cancelled. Emits job.progress. */
  'packs.import': ImportReport | null
  /** Moves the pack folder to the OS trash. */
  'packs.delete': void
  /** Shows the pack folder in Finder / Explorer. */
  'packs.reveal': void
  'pack.get': PackSummary
  'pack.textures': TextureEntry[]
  'pack.categories': CategorySummary[]
  /** Opens a save dialog; null when cancelled. Emits job.progress. */
  'pack.export': ExportReport | null
  /** Opens a folder picker; null when cancelled. Emits job.progress per target. */
  'pack.exportMany': ExportReport[] | null
  /** Moves the pack to a newer authoring version (renames along the migration chain). */
  'pack.upgrade': UpgradeReport
  /** Pack Doctor: problems in the pack and what each export target would change. */
  'pack.doctor': DoctorReport
  'texture.read': TextureData
  /** Writes the PNG into the pack (records a history entry) and returns the updated texture entry. */
  'texture.save': TextureEntry
  /** Deletes the pack's copy so the vanilla texture is used again (records a history entry). */
  'texture.revert': TextureEntry
  'history.get': HistoryState
  'history.undo': HistoryState
  'history.redo': HistoryState
  /** How to show the texture in 3D: block model, item sprite, entity geometry or flat fallback. */
  'texture.preview': PreviewModel
  'ai.providers.list': ProviderStatus[]
  'ai.providers.save': ProviderStatus[]
  'ai.providers.delete': ProviderStatus[]
  /** Stores the key encrypted (empty string removes it). The key never comes back to the renderer. */
  'ai.providers.setKey': ProviderStatus
  'ai.providers.test': {
    ok: boolean
    modelCount?: number
    error?: { code: string; params?: Record<string, string | number> }
  }
  'ai.models.list': ModelInfo[]
  /** Starts an editor-agent run; progress arrives as 'ai.event'. */
  'ai.agent.send': { runId: string }
  'ai.agent.stop': void
  'ai.agent.conversation': ConversationTurn[]
  'ai.agent.clear': void
  'ai.proposal.apply': ProposalApplyResult
  'ai.proposal.reject': void
  /** Starts a navigation-agent run on a selection; progress arrives as 'ai.event'. */
  'ai.navigation.send': { runId: string }
  /** Replays the accepted steps on the accepted textures and writes them as one history entry. */
  'ai.navigation.apply': BulkProposalApplyResult
  'ai.creation.send': { runId: string }
  /** Resolves when every accepted step is written (or after Stop); emits job.progress 'ai.plan.apply'. */
  'ai.creation.apply': CreationApplyResult
  'ai.creation.stopApply': void
  /** Computes a manual bulk action (worker thread, emits job.progress). Nothing is written. */
  'bulk.preview': BulkPreview
  /** Writes the ticked textures of a preview as one undoable history entry. */
  'bulk.apply': BulkApplyResult
  'bulk.discard': void
  /** Reads and classifies; nothing is written. */
  'merge.preview': MergePlan
  /** One history entry in the target (created first for a new pack). */
  'merge.apply': MergeResult
  'merge.discard': void
  'brief.get': StyleBrief
  'brief.update': StyleBrief
  /** Runs the FR/EN evaluation against a model (quick: a subset). Progress arrives as 'ai.eval.progress'. */
  'ai.eval.run': EvalReport
  'ai.eval.stop': void
}

export type InvokeInput<C extends InvokeChannel> = z.input<(typeof inputSchemas)[C]>
export type InvokeOutput<C extends InvokeChannel> = InvokeOutputs[C]

export interface EventPayloads {
  'settings.changed': Settings
  'updater.status': UpdaterStatus
  'job.progress': JobProgress
  /** The pack list or a pack's files changed (create, import, delete, external edit). */
  'packs.changed': { packId?: string }
  'ai.event': AgentEvent
  'ai.eval.progress': EvalProgress
}

export type EventPayload<E extends EventChannel> = EventPayloads[E]

/** The API exposed on `window.blocksmith` by the preload script. */
export interface BlocksmithApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeInput<C> extends undefined ? [] : [InvokeInput<C>]
  ): Promise<Result<InvokeOutput<C>>>
  on<E extends EventChannel>(channel: E, listener: (payload: EventPayload<E>) => void): () => void
}
