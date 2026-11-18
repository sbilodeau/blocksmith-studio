import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { HistoryEntry } from '@shared/model/history'
import type {
  MergeApplyInput,
  MergeCandidate,
  MergeConflict,
  MergePlan,
  MergePreviewInput,
  MergeResult
} from '@shared/model/merge'
import type { CreatePackInput, PackSummary } from '@shared/model/pack'
import type { StyleBrief, StyleBriefPatch } from '@shared/model/brief'
import { findVersion, versionTable } from '@shared/versions'
import { PathMigrator, canMigrate } from '@shared/versions/migrations'
import { AppErrorException } from '../../ipc/registry'
import { parseJson, toJsonBytes } from '../packs/mcmeta'
import { scanFiles } from '../packs/paths'
import type { PackLocation } from '../packs/project'
import { combineBriefs, combineJson, mergeableKind } from './combine'

/** Plans are kept this long before apply (then the user previews again). */
export const MERGE_PLAN_TTL_MS = 30 * 60 * 1000
/** Conflict thumbnails / text previews larger than this are left out of the plan. */
const MAX_PREVIEW_BYTES = 256 * 1024
const MAX_TEXT = 4000

export const MergeErrorCode = {
  planExpired: 'merge.planExpired',
  targetIsSource: 'merge.targetIsSource'
} as const

export interface MergeServiceDeps {
  packs: {
    locate(packId: string): Promise<PackLocation | null>
    create(input: CreatePackInput): Promise<PackSummary>
    get(packId: string): Promise<PackSummary>
  }
  history: {
    apply(
      packId: string,
      change: {
        source: HistoryEntry['source']
        label: HistoryEntry['label']
        changes: Array<{ path: string; after: Uint8Array | null }>
      }
    ): Promise<HistoryEntry>
  }
  brief: {
    get(packId: string): Promise<StyleBrief>
    change(
      packId: string,
      change: { patches?: StyleBriefPatch[]; by: 'user'; decision?: string }
    ): Promise<StyleBrief>
  }
  now?: () => number
  newId?: () => string
  ttlMs?: number
}

export interface MergeService {
  /** Reads the sources and the target and classifies every file. Nothing is written. */
  preview(input: MergePreviewInput): Promise<MergePlan>
  /** Writes the plan (with the user's conflict choices) as one history entry in the target. Single use. */
  apply(input: MergeApplyInput): Promise<MergeResult>
  discard(planId: string): void
}

interface FileData {
  data: Uint8Array
  sha256: string
}

interface StoredPlan {
  plan: MergePlan
  at: number
  input: MergePreviewInput
  /** New target: base and icon come from the highest-priority source. */
  newBase?: CreatePackInput['base']
  newIcon?: Uint8Array
  /** Contents to write per path: added files and merged JSON. */
  writes: Map<string, Uint8Array>
  /** Conflicts: content per origin. */
  options: Map<string, Map<string, Uint8Array>>
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

function releaseMs(id: string): number {
  const v = findVersion(versionTable, id)
  return v ? Date.parse(v.releaseTime) : 0
}

function kindOf(path: string): MergeConflict['kind'] {
  if (path.endsWith('.png')) return 'png'
  if (path.endsWith('.json') || path.endsWith('.mcmeta')) return 'json'
  return 'other'
}

/** Files of a pack keyed by path, without pack.mcmeta / pack.png (the target keeps its own). */
async function readPackFiles(
  folder: string,
  only?: ReadonlySet<string>
): Promise<{ files: Map<string, FileData>; icon?: Uint8Array }> {
  const files = new Map<string, FileData>()
  let icon: Uint8Array | undefined
  for (const f of await scanFiles(folder)) {
    if (f.path === 'pack.mcmeta') continue
    if (f.path === 'pack.png') {
      icon = new Uint8Array(await fs.readFile(f.abs))
      continue
    }
    if (only && !only.has(f.path)) continue
    const data = new Uint8Array(await fs.readFile(f.abs))
    files.set(f.path, { data, sha256: sha256(data) })
  }
  return { files, ...(icon ? { icon } : {}) }
}

export function createMergeService(deps: MergeServiceDeps): MergeService {
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? ((): string => randomUUID())
  const ttl = deps.ttlMs ?? MERGE_PLAN_TTL_MS
  const plans = new Map<string, StoredPlan>()

  function expire(): void {
    for (const [id, p] of plans) if (now() - p.at > ttl) plans.delete(id)
  }

  async function requireLocation(packId: string): Promise<PackLocation> {
    const location = await deps.packs.locate(packId)
    if (!location) throw new AppErrorException('packs.notFound', { packId })
    return location
  }

  function candidate(
    origin: string,
    originName: string,
    path: string,
    file: FileData
  ): MergeCandidate {
    const c: MergeCandidate = { origin, originName, sha256: file.sha256, size: file.data.length }
    if (file.data.length <= MAX_PREVIEW_BYTES) {
      if (path.endsWith('.png')) c.png = file.data
      else c.text = new TextDecoder().decode(file.data.slice(0, MAX_TEXT))
    }
    return c
  }

  return {
    async preview(input) {
      expire()
      const sourceIds = [...new Set(input.sources)]
      const sources = await Promise.all(sourceIds.map(requireLocation))
      const target =
        input.target.kind === 'pack' ? await requireLocation(input.target.packId) : undefined
      if (target && sourceIds.includes(target.id)) {
        throw new AppErrorException(MergeErrorCode.targetIsSource)
      }
      // A new pack uses the newest authoring version of its sources (older sources are migrated up).
      const targetVersion =
        target?.project.authoringVersion ??
        [...sources]
          .map((s) => s.project.authoringVersion)
          .sort((a, b) => releaseMs(b) - releaseMs(a))[0]!

      const only = input.paths ? new Set(input.paths.flatMap((p) => [p, `${p}.mcmeta`])) : undefined
      const targetFiles = target ? (await readPackFiles(target.folder)).files : new Map()

      // Candidates per path, sources in priority order.
      const byPath = new Map<string, Array<{ origin: string; file: FileData }>>()
      const skipped: MergePlan['skipped'] = []
      let renamed = 0
      let newIcon: Uint8Array | undefined
      for (const [i, source] of sources.entries()) {
        const read = await readPackFiles(source.folder, only)
        if (i === 0) newIcon = read.icon
        const from = source.project.authoringVersion
        const migrator =
          from !== targetVersion && canMigrate(from, targetVersion)
            ? new PathMigrator(from, targetVersion)
            : null
        for (const [sourcePath, file] of read.files) {
          let path = sourcePath
          if (migrator) {
            const r = migrator.migrateFile(sourcePath)
            if (!('path' in r)) {
              skipped.push({ path: sourcePath, origin: source.id, reason: 'notInVersion' })
              continue
            }
            if (r.renamed) {
              renamed++
              path = r.path
            }
          }
          const list = byPath.get(path) ?? []
          if (!list.some((c) => c.origin === source.id)) list.push({ origin: source.id, file })
          byPath.set(path, list)
        }
      }

      const names = new Map(sources.map((s) => [s.id, s.project.name]))
      const targetName =
        target?.project.name ?? (input.target.kind === 'new' ? input.target.name : '')
      const added: string[] = []
      const merged: string[] = []
      const conflicts: MergeConflict[] = []
      const writes = new Map<string, Uint8Array>()
      const options = new Map<string, Map<string, Uint8Array>>()
      let identical = 0

      for (const [path, list] of [...byPath].sort((a, b) => a[0].localeCompare(b[0]))) {
        const existing = targetFiles.get(path) as FileData | undefined
        const shas = new Set(list.map((c) => c.file.sha256))
        if (existing && shas.size === 1 && shas.has(existing.sha256)) {
          identical++
          continue
        }
        if (!existing && shas.size === 1) {
          added.push(path)
          writes.set(path, list[0]!.file.data)
          continue
        }
        const kind = mergeableKind(path)
        if (kind) {
          const docs = [...list.map((c) => c.file.data), ...(existing ? [existing.data] : [])].map(
            (d) => parseJson(d)
          )
          const combined = combineJson(kind, docs)
          if (combined !== null) {
            const bytes = toJsonBytes(combined)
            if (existing && sha256(bytes) === existing.sha256) identical++
            else {
              merged.push(path)
              writes.set(path, bytes)
            }
            continue
          }
        }
        // Distinct contents, highest priority first; the target's last.
        const seen = new Set<string>()
        const candidates: MergeCandidate[] = []
        const contents = new Map<string, Uint8Array>()
        for (const c of list) {
          if (seen.has(c.file.sha256)) continue
          seen.add(c.file.sha256)
          candidates.push(candidate(c.origin, names.get(c.origin) ?? c.origin, path, c.file))
          contents.set(c.origin, c.file.data)
        }
        if (existing && !seen.has(existing.sha256)) {
          candidates.push(candidate('target', targetName, path, existing))
        }
        conflicts.push({ path, kind: kindOf(path), candidates, choice: candidates[0]!.origin })
        options.set(path, contents)
      }

      const plan: MergePlan = {
        id: newId(),
        target: {
          ...(target ? { packId: target.id } : {}),
          name: targetName,
          authoringVersion: targetVersion,
          created: !target
        },
        sources: sources.map((s) => ({
          packId: s.id,
          name: s.project.name,
          authoringVersion: s.project.authoringVersion
        })),
        added,
        identical,
        merged,
        conflicts,
        skipped,
        renamed,
        mergeBriefs: input.mergeBriefs
      }
      plans.set(plan.id, {
        plan,
        at: now(),
        input,
        ...(target ? {} : { newBase: sources[0]!.project.base }),
        ...(newIcon && !target ? { newIcon } : {}),
        writes,
        options
      })
      return plan
    },

    async apply({ planId, choices }) {
      expire()
      const stored = plans.get(planId)
      if (!stored) throw new AppErrorException(MergeErrorCode.planExpired)
      plans.delete(planId)
      const { plan, input } = stored

      let targetId = plan.target.packId
      if (!targetId && input.target.kind === 'new') {
        const created = await deps.packs.create({
          name: input.target.name,
          description: input.target.description,
          base: stored.newBase ?? 'vanilla',
          // Custom items (M14) need a combined pack; other merges keep the default kind.
          ...([...stored.writes.keys(), ...plan.conflicts.map((c) => c.path)].some((p) =>
            p.startsWith('blocksmith/items/')
          )
            ? { kind: 'combined' as const }
            : {}),
          authoringVersion: plan.target.authoringVersion
        })
        targetId = created.id
      }
      if (!targetId) throw new AppErrorException(MergeErrorCode.planExpired)

      const changes: Array<{ path: string; after: Uint8Array | null }> = []
      for (const [path, data] of stored.writes) changes.push({ path, after: data })
      for (const conflict of plan.conflicts) {
        const origin = choices[conflict.path] ?? conflict.choice
        if (origin === 'target') continue
        const data = stored.options.get(conflict.path)?.get(origin)
        if (data) changes.push({ path: conflict.path, after: data })
      }
      if (plan.target.created && stored.newIcon)
        changes.push({ path: 'pack.png', after: stored.newIcon })
      if (changes.length > 0) {
        await deps.history.apply(targetId, {
          source: 'merge',
          label: { key: 'merge', params: { count: changes.length, packs: plan.sources.length } },
          changes
        })
      }

      let briefMerged = false
      if (plan.mergeBriefs) {
        const [targetBrief, ...sourceBriefs] = await Promise.all([
          deps.brief.get(targetId),
          ...plan.sources.map((s) => deps.brief.get(s.packId))
        ])
        const patch = combineBriefs(targetBrief!, sourceBriefs)
        if (patch) {
          await deps.brief.change(targetId, {
            patches: [patch],
            by: 'user',
            decision: `Merged the style briefs of ${plan.sources.map((s) => s.name).join(', ')}`
          })
          briefMerged = true
        }
      }
      return {
        pack: await deps.packs.get(targetId),
        written: changes.length,
        created: plan.target.created,
        briefMerged
      }
    },

    discard(planId) {
      plans.delete(planId)
    }
  }
}
