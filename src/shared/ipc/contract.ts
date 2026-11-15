import { z } from 'zod'
import type { InvokeChannel, EventChannel } from './channels'
import { SettingsPatchSchema, type Settings } from '../model/settings'
import type { UpdaterStatus } from '../model/updater'
import type { MinecraftInstall, VanillaAvailability } from '../model/vanilla'
import {
  CreatePackInputSchema,
  type CategorySummary,
  type ExportReport,
  type ImportReport,
  type PackSummary,
  type TextureEntry
} from '../model/pack'
import type { JobProgress } from '../model/jobs'
import type { HistoryState, TextureData } from '../model/history'
import type { PreviewModel } from '../model/preview'

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
  'pack.export': PackRef.extend({ targetVersion: VersionId }).strict(),
  'texture.read': TextureRef,
  'texture.save': TextureRef.extend({
    png: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= MAX_PNG_BYTES)
  }).strict(),
  'texture.revert': TextureRef,
  'history.get': PackRef,
  'history.undo': PackRef,
  'history.redo': PackRef,
  'texture.preview': TextureRef
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
}

export type InvokeInput<C extends InvokeChannel> = z.input<(typeof inputSchemas)[C]>
export type InvokeOutput<C extends InvokeChannel> = InvokeOutputs[C]

export interface EventPayloads {
  'settings.changed': Settings
  'updater.status': UpdaterStatus
  'job.progress': JobProgress
  /** The pack list or a pack's files changed (create, import, delete, external edit). */
  'packs.changed': { packId?: string }
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
