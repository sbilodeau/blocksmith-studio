/**
 * Long-running operations (vanilla extraction, import, export) resolve their invoke() when finished and
 * report progress meanwhile through the 'job.progress' event.
 */
export type JobKind =
  | 'vanilla.prepare'
  | 'packs.import'
  | 'pack.export'
  | 'bulk.preview'
  | 'bulk.apply'
  /** Creation agent plan: one progress tick per applied step (each step is one history entry). */
  | 'ai.plan.apply'

export interface JobProgress {
  jobId: string
  kind: JobKind
  /** i18n key suffix under `jobs.phase.*`: "download", "extract", "index", "write"... */
  phase: string
  done: number
  total: number
}
